import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { APP_CONFIG } from '../../src/config/app-config.module.js';
import { loadConfig, type AppConfig } from '../../src/config/load-config.js';
import { configureApp } from '../../src/http/configure-app.js';
import { CONTACT_NOTIFIER } from '../../src/modules/contact/notifications/contact-notifier.js';
import { RECAPTCHA_VERIFIER } from '../../src/modules/contact/recaptcha/recaptcha.js';
import { GOOGLE_IDENTITY_GATEWAY } from '../../src/modules/users/google/google-identity.gateway.js';
import {
  FakeContactNotifier,
  FakeRecaptchaVerifier,
  RECAPTCHA_TEST_HOSTNAME,
} from './fake-contact-gateways.js';
import { FakeGoogleIdentityGateway } from './fake-google-identity.gateway.js';
import { assertTestDatabase, testDatabaseName } from './test-database-guard.js';

export type TestAppOptions = Readonly<{
  /** Overrides AUTH_ADMIN_EMAILS for this app only. */
  adminEmails?: readonly string[];
  /** Overrides the media storage settings for this app only (blog completion B3). */
  media?: Partial<AppConfig['media']>;
  /** Overrides the contact settings for this app only (contact form). */
  contact?: Partial<AppConfig['contact']>;
  /** Overrides TRUST_PROXY_HOPS, so a test can set the client IP through X-Forwarded-For. */
  trustProxyHops?: number;
  /** Overrides the payment settings (course sales); the default is VNPAY with TEST_VNPAY's fake terminal. */
  payments?: AppConfig['payments'];
}>;

/** e2e's VNPAY terminal: never a real one, so a test-signed IPN can only ever reach a test app. */
export const TEST_VNPAY = {
  tmnCode: 'TESTTMN1',
  hashSecret: 'test-vnpay-secret',
  paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  returnUrl: 'http://localhost:3000/khoa-hoc/thanh-toan/ket-qua',
} as const;

/**
 * Same AppModule + same configureApp() as main.ts (D6). Refuses to start against a non-*_test database (I21).
 * Google sign-in, Google reCAPTCHA and the email provider are always replaced by fakes: e2e never contacts Google
 * and never sends an email. reCAPTCHA runs in `verify` mode against the fake unless a test overrides it.
 */
export async function createTestApp(
  extraImports: Type[] = [],
  options: TestAppOptions = {},
): Promise<NestExpressApplication> {
  const loaded = loadConfig();
  testDatabaseName(loaded.database.url); // fail closed before any connection is opened
  const testConfig: AppConfig = {
    ...loaded,
    auth: options.adminEmails ? { ...loaded.auth, adminEmails: options.adminEmails } : loaded.auth,
    media: { ...loaded.media, ...options.media },
    trustProxyHops: options.trustProxyHops ?? loaded.trustProxyHops,
    contact: {
      recaptcha: {
        mode: 'verify',
        secretKey: 'test-recaptcha-secret',
        allowedHostnames: [RECAPTCHA_TEST_HOSTNAME],
        minScore: 0.5,
      },
      email: { provider: 'disabled' }, // the fake notifier below replaces any provider
      ...options.contact,
    },
    payments: options.payments ?? { provider: 'vnpay', vnpay: TEST_VNPAY },
  };
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...extraImports],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig)
    .overrideProvider(GOOGLE_IDENTITY_GATEWAY)
    .useValue(new FakeGoogleIdentityGateway())
    .overrideProvider(RECAPTCHA_VERIFIER)
    .useValue(new FakeRecaptchaVerifier())
    .overrideProvider(CONTACT_NOTIFIER)
    .useValue(new FakeContactNotifier())
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: ['error'],
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  const [{ name }] = await app
    .get(DataSource)
    .query<{ name: string }[]>('SELECT current_database() AS name');
  assertTestDatabase(config.database.url, name);
  configureApp(app, config);
  await app.init();
  return app;
}

export function fakeGoogle(app: NestExpressApplication): FakeGoogleIdentityGateway {
  return app.get(GOOGLE_IDENTITY_GATEWAY);
}

export function fakeRecaptcha(app: NestExpressApplication): FakeRecaptchaVerifier {
  return app.get(RECAPTCHA_VERIFIER);
}

export function fakeNotifier(app: NestExpressApplication): FakeContactNotifier {
  return app.get(CONTACT_NOTIFIER);
}
