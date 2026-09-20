import { env } from "../config/env.js";
import { makeSubmitApplication } from "../usecases/applications/submit-application.js";
import { makeCreateUploadTicket } from "../usecases/applications/create-upload-ticket.js";
import {
  makeCountApplications,
  makeDeleteApplication,
  makeGetApplication,
  makeListApplications,
  makeUpdateApplication,
} from "../usecases/applications/review-applications.js";
import { makeLogin } from "../usecases/auth/login.js";
import {
  makeCountUnread,
  makeListNotifications,
  makeMarkAllNotificationsRead,
  makeMarkNotificationRead,
} from "../usecases/notifications/read-notifications.js";
import {
  makeChangeOwnPassword,
  makeCreateUser,
  makeDeleteUser,
  makeListUsers,
  makeUpdateUser,
} from "../usecases/users/manage-users.js";
import {
  makeCreateRental,
  makeDeleteRental,
  makeGetRental,
  makeListRentals,
  makeUpdateRental,
} from "../usecases/rentals/manage-rentals.js";
import { makeSendRentalReminders } from "../usecases/rentals/send-rental-reminders.js";
import {
  makeCreateVehicle,
  makeDeleteVehicle,
  makeListVehicles,
  makeUpdateVehicle,
} from "../usecases/vehicles/manage-vehicles.js";
import { JwtTokenIssuer } from "./crypto/jwt-token-issuer.js";
import { ScryptPasswordHasher } from "./crypto/scrypt-password-hasher.js";
import { DynamoApplicationRepository } from "./dynamodb/application-repository.js";
import { DynamoNotificationRepository } from "./dynamodb/notification-repository.js";
import { DynamoRateLimiter } from "./dynamodb/rate-limiter.js";
import { DynamoRentalRepository } from "./dynamodb/rental-repository.js";
import { DynamoUserRepository } from "./dynamodb/user-repository.js";
import { DynamoVehicleRepository } from "./dynamodb/vehicle-repository.js";
import { S3DocumentStorage } from "./s3/document-storage.js";
import { systemClock, uuidGenerator } from "./system.js";
import { TelegramNotifier } from "./telegram/telegram-notifier.js";

/**
 * The composition root: the one module allowed to know both a port and its
 * adapter. Everything above it receives functions, so swapping DynamoDB for
 * anything else is an edit to this file alone.
 *
 * Built once at module load — in Lambda that puts the SDK client construction
 * in the init phase, off the request's latency budget.
 */
function build() {
  const users = new DynamoUserRepository();
  const applications = new DynamoApplicationRepository();
  const vehicles = new DynamoVehicleRepository();
  const notifications = new DynamoNotificationRepository();
  const rentals = new DynamoRentalRepository();
  const storage = new S3DocumentStorage();
  const rateLimiter = new DynamoRateLimiter();
  const hasher = new ScryptPasswordHasher();
  const tokens = new JwtTokenIssuer();
  const chat = new TelegramNotifier("applications");
  const rentalChat = new TelegramNotifier("rentals");
  const clock = systemClock;
  const ids = uuidGenerator;

  const shared = { users, hasher, clock, ids };
  const rentalWrites = { rentals, chat: rentalChat, clock, ids, consoleBaseUrl: env.CONSOLE_BASE_URL };

  return {
    tokens,
    users,

    login: makeLogin({ users, hasher, tokens, clock, rateLimiter }),

    listUsers: makeListUsers({ users }),
    createUser: makeCreateUser(shared),
    updateUser: makeUpdateUser(shared),
    deleteUser: makeDeleteUser({ users }),
    changeOwnPassword: makeChangeOwnPassword({ users, hasher, clock }),

    submitApplication: makeSubmitApplication({
      applications,
      notifications,
      users,
      storage,
      chat,
      clock,
      ids,
      rateLimiter,
      consoleBaseUrl: env.CONSOLE_BASE_URL,
    }),
    createUploadTicket: makeCreateUploadTicket({ storage, ids, rateLimiter }),
    listApplications: makeListApplications({ applications }),
    countApplications: makeCountApplications({ applications }),
    getApplication: makeGetApplication({ applications, storage }),
    updateApplication: makeUpdateApplication({ applications, clock }),
    deleteApplication: makeDeleteApplication({ applications, storage }),

    listVehicles: makeListVehicles({ vehicles }),
    createVehicle: makeCreateVehicle({ vehicles }),
    updateVehicle: makeUpdateVehicle({ vehicles }),
    deleteVehicle: makeDeleteVehicle({ vehicles }),

    listRentals: makeListRentals({ rentals }),
    getRental: makeGetRental({ rentals }),
    createRental: makeCreateRental(rentalWrites),
    updateRental: makeUpdateRental(rentalWrites),
    deleteRental: makeDeleteRental({ rentals }),
    sendRentalReminders: makeSendRentalReminders({
      rentals,
      chat: rentalChat,
      clock,
      consoleBaseUrl: env.CONSOLE_BASE_URL,
    }),

    listNotifications: makeListNotifications({ notifications }),
    countUnread: makeCountUnread({ notifications }),
    markNotificationRead: makeMarkNotificationRead({ notifications, clock }),
    markAllNotificationsRead: makeMarkAllNotificationsRead({ notifications, clock }),
  };
}

export type Container = ReturnType<typeof build>;

export const container: Container = build();
