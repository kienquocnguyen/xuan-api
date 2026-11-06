import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, In, type Repository } from 'typeorm';
import { CourseAccessGrant } from './course-access-grant.entity.js';
import { CourseAccessService } from './course-access.service.js';
import { Course } from './course.entity.js';

export type CourseForSale = Readonly<{
  id: string;
  slug: string;
  title: string;
  priceVnd: number | null;
}>;
export type CourseLabel = Readonly<{ id: string; slug: string; title: string }>;

/**
 * The courses module's only export to `orders` (course sales spec §5.1): what a checkout needs to know about a
 * course, and the purchase grant. The grant rows and their rules stay here (I1); `orders` never touches them.
 */
@Injectable()
export class CourseSales {
  constructor(
    @InjectRepository(Course) private readonly courses: Repository<Course>,
    private readonly access: CourseAccessService,
  ) {}

  /** A **published** course with its price (`null` = not for sale), or null. */
  async findForSale(courseId: string): Promise<CourseForSale | null> {
    const course = await this.courses.findOneBy({ id: courseId, status: 'published' });
    return course
      ? { id: course.id, slug: course.slug, title: course.title, priceVnd: course.priceVnd }
      : null;
  }

  /** Labels for order views, whatever the course's status now (an order outlives an unpublish). */
  async findLabels(ids: readonly string[]): Promise<ReadonlyMap<string, CourseLabel>> {
    if (ids.length === 0) return new Map();
    const found = await this.courses.find({
      select: { id: true, slug: true, title: true },
      where: { id: In([...new Set(ids)]) },
    });
    return new Map(found.map((course) => [course.id, course]));
  }

  hasActiveAccess(userId: string, courseId: string): Promise<boolean> {
    return this.access.hasActiveAccess(userId, courseId);
  }

  /**
   * Inserts the purchase grant through the IPN transaction's manager (I8), unconditionally: the paid order is the
   * authority (S13), whatever the course's status, price or the buyer's other grants. One per order:
   * uq_course_access_grants_order_id_purchase is the backstop behind the IPN's row lock.
   */
  async grantForPurchase(
    manager: EntityManager,
    input: Readonly<{ userId: string; courseId: string; orderId: string }>,
  ): Promise<void> {
    await manager.insert(CourseAccessGrant, {
      userId: input.userId,
      courseId: input.courseId,
      orderId: input.orderId,
      source: 'purchase',
      grantedByUserId: null,
    });
  }
}
