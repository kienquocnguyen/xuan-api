import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, AppConfigModule } from '../../config/app-config.module.js';
import type { AppConfig } from '../../config/load-config.js';
import { AdminCoachingRegistrationsController } from './coaching/admin-coaching-registrations.controller.js';
import { CoachingInboxService } from './coaching/coaching-inbox.service.js';
import { CoachingRegistration } from './coaching/coaching-registration.entity.js';
import { CoachingRegistrationsController } from './coaching/coaching-registrations.controller.js';
import { CoachingRegistrationsService } from './coaching/coaching-registrations.service.js';
import { AdminContactSubmissionsController } from './admin-contact-submissions.controller.js';
import { ContactController } from './contact.controller.js';
import { ContactInboxService } from './contact-inbox.service.js';
import { ContactSubmission } from './contact-submission.entity.js';
import { ContactSubmissionsService } from './contact-submissions.service.js';
import { ContactNotificationsService } from './notifications/contact-notifications.service.js';
import { CONTACT_NOTIFIER, createContactNotifier } from './notifications/contact-notifier.js';
import { HumanCheckService } from './recaptcha/human-check.service.js';
import { createRecaptchaVerifier } from './recaptcha/create-recaptcha-verifier.js';
import { RECAPTCHA_VERIFIER } from './recaptcha/recaptcha.js';

/** The contact form (contact form design): the only registration of both its tables, contact_submissions and coaching_registrations (I1); exports nothing. */
@Module({
  imports: [TypeOrmModule.forFeature([ContactSubmission, CoachingRegistration]), AppConfigModule],
  controllers: [
    ContactController,
    CoachingRegistrationsController,
    AdminContactSubmissionsController,
    AdminCoachingRegistrationsController,
  ],
  providers: [
    ContactSubmissionsService,
    CoachingRegistrationsService,
    ContactInboxService,
    CoachingInboxService,
    ContactNotificationsService,
    HumanCheckService,
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
