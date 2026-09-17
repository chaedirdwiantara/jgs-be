/**
 * Where the identity photos live.
 *
 * The browser uploads straight to object storage — the API only ever hands out
 * short-lived, tightly-scoped tickets. Photos never pass through the Lambda, so
 * a 6 MB KTP scan costs no request payload and no execution time.
 */

/** A browser-fillable POST form. The policy pins content type and max size. */
export type UploadTicket = {
  /** Where the browser POSTs the multipart form. */
  url: string;
  /** Every one of these must be sent as a form field, before the file. */
  fields: Record<string, string>;
  /** The object key the upload will land on — echoed back on submit. */
  key: string;
  expiresAt: string;
};

export interface DocumentStorage {
  /**
   * @param key      Object key to create, under the staging prefix.
   * @param maxBytes Hard ceiling enforced by the storage service, not by us.
   */
  createUploadTicket(args: {
    key: string;
    contentType: string;
    maxBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadTicket>;

  /** Time-limited read URL for the console's document viewer. */
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;

  /**
   * Moves a staged upload to its permanent key. Returns the object's real size
   * and content type as stored, which is the only trustworthy source — the
   * browser's claims are not.
   */
  promote(
    stagingKey: string,
    finalKey: string,
  ): Promise<{ contentType: string; sizeBytes: number }>;

  /** Best-effort cleanup; a failure here must not fail the caller. */
  remove(keys: string[]): Promise<void>;
}
