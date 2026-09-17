import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../../config/env.js";
import { ValidationError } from "../../domain/shared/errors.js";
import type { DocumentStorage, UploadTicket } from "../../domain/storage/document-storage.js";
import { logger } from "../logging/logger.js";

const client = new S3Client({ region: env.AWS_REGION });

export class S3DocumentStorage implements DocumentStorage {
  async createUploadTicket(args: {
    key: string;
    contentType: string;
    maxBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadTicket> {
    /*
     * A presigned **POST** rather than a presigned PUT: only the POST policy can
     * carry `content-length-range`, so S3 itself rejects an oversized upload.
     * With a PUT the size limit would be a promise the browser could simply not
     * keep.
     */
    const { url, fields } = await createPresignedPost(client, {
      Bucket: env.DOCUMENTS_BUCKET,
      Key: args.key,
      Expires: args.expiresInSeconds,
      Conditions: [
        ["content-length-range", 1, args.maxBytes],
        ["eq", "$Content-Type", args.contentType],
        ["eq", "$key", args.key],
      ],
      Fields: { "Content-Type": args.contentType },
    });

    return {
      url,
      fields,
      key: args.key,
      expiresAt: new Date(Date.now() + args.expiresInSeconds * 1000).toISOString(),
    };
  }

  async createDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: env.DOCUMENTS_BUCKET, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async promote(
    stagingKey: string,
    finalKey: string,
  ): Promise<{ contentType: string; sizeBytes: number }> {
    /*
     * The key comes in from the browser, so it is treated as hostile: it must
     * be one this API handed out, under the staging prefix. Without this check
     * a caller could name any object in the bucket — including another
     * applicant's stored documents — and have it copied into their own record.
     */
    if (!/^uploads\/[A-Za-z0-9_-]+\/[a-zA-Z]+\.[a-z0-9]+$/.test(stagingKey)) {
      throw ValidationError("Referensi berkas tidak valid. Unggah ulang dokumen Anda.");
    }

    let head;
    try {
      head = await client.send(
        new HeadObjectCommand({ Bucket: env.DOCUMENTS_BUCKET, Key: stagingKey }),
      );
    } catch {
      throw ValidationError(
        "Berkas yang diunggah sudah kedaluwarsa. Unggah ulang dokumen Anda.",
      );
    }

    await client.send(
      new CopyObjectCommand({
        Bucket: env.DOCUMENTS_BUCKET,
        Key: finalKey,
        // `CopySource` is URL-encoded per path segment — encoding the whole
        // string would turn the separators into %2F and address a key that
        // does not exist.
        CopySource: [env.DOCUMENTS_BUCKET, ...stagingKey.split("/")]
          .map(encodeURIComponent)
          .join("/"),
        MetadataDirective: "COPY",
      }),
    );

    // The staging copy would expire on its own via the bucket lifecycle rule;
    // removing it now just means one less copy of an identity document.
    await this.remove([stagingKey]);

    return {
      contentType: head.ContentType ?? "application/octet-stream",
      sizeBytes: head.ContentLength ?? 0,
    };
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    try {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: env.DOCUMENTS_BUCKET,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    } catch (cause) {
      // Cleanup is best-effort by contract: the lifecycle rule is the backstop.
      logger.warn("document_cleanup_failed", {
        count: keys.length,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
}
