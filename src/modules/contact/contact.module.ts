import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, AppConfigModule } from '../../config/app-config.module.js';
import type { AppConfig } from '../../config/load-config.js';
import { AdminContactSubmissionsController } from './admin-contact-submissions.controller.js';
import { ContactController } from './contact.controller.js';
import { ContactInboxService } from './contact-inbox.service.js';
import { ContactNotificationsCronController } from './contact-notifications-cron.controller.js';
import { ContactSubmission } from './contact-submission.entity.js';
import { ContactSubmissionsService } from './contact-submissions.service.js';
import { ContactNotificationsService } from './notifications/contact-notifications.service.js';
import { CONTACT_NOTIFIER, createContactNotifier } from './notifications/contact-notifier.js';
import { createRecaptchaVerifier } from './recaptcha/create-recaptcha-verifier.js';
import { RECAPTCHA_VERIFIER } from './recaptcha/recaptcha.js';

/** The contact form (contact form design): its table's only registration (I1); exports nothing. */
@Module({
  imports: [TypeOrmModule.forFeature([ContactSubmission]), AppConfigModule],
  controllers: [
    ContactController,
    AdminContactSubmissionsController,
    ContactNotificationsCronController,
  ],
  providers: [
    ContactSubmissionsService,
    ContactInboxService,
    ContactNotificationsService,
    // Gateways chosen from config (C5).
    {
      provide: RECAPTCHA_VERIFIER,
      useFactory: (config: AppConfig) => createRecaptchaVerifier(config),
      inject: [APP_CONFIG],
    },
    {
      provide: CONTACT_NOTIFIER,
      useFactory: (config: AppConfig) => createContactNotifier(config),
      inject: [APP_CONFIG],
    },
  ],
})
export class ContactModule {}
