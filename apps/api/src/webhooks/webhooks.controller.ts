import {
  BadRequestException,
  Controller,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { Prisma, type Db } from "@releaselens/db";
import { WebhookEnvelopeSchema, verifyWebhookSignature } from "@releaselens/integrations";
import type { Request, Response } from "express";
import { Public, SkipOriginCheck } from "../auth/public.decorator.js";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { DB } from "../db/db.module.js";
import { JOBS, type Jobs } from "../jobs/jobs.module.js";

const DELIVERY_ID = /^[0-9a-fA-F-]{8,64}$/;
const EVENT_NAME = /^[a-z_]{1,64}$/;

/** Prisma's unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * GitHub App webhook intake. Authenticated by HMAC signature, not by session or origin.
 * Kept deliberately small and fast: verify, store, enqueue, respond. All processing
 * happens in the worker. GitHub delivers at least once, so storage is keyed by the
 * delivery ID and a redelivery is acknowledged without being processed again.
 */
@ApiExcludeController()
@Public()
@SkipOriginCheck()
@SkipThrottle()
@Controller("webhooks")
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Db,
    @Inject(JOBS) private readonly jobs: Jobs,
  ) {}

  @Post("github")
  async github(
    @Req() req: Request,
    @Res() res: Response,
    @Headers("x-github-event") event?: string,
    @Headers("x-github-delivery") deliveryId?: string,
    @Headers("x-hub-signature-256") signature?: string,
  ): Promise<void> {
    const secret = this.config.githubWebhookSecret;
    if (secret === null) throw new NotFoundException();

    const body: unknown = req.body;
    if (!Buffer.isBuffer(body)) throw new BadRequestException("Expected a raw request body");
    if (!verifyWebhookSignature(secret, body, signature)) {
      this.logger.warn(
        { deliveryId: DELIVERY_ID.test(deliveryId ?? "") ? deliveryId : undefined },
        "Rejected webhook with invalid signature",
      );
      throw new UnauthorizedException("Invalid signature");
    }
    if (deliveryId === undefined || !DELIVERY_ID.test(deliveryId)) {
      throw new BadRequestException("Missing or invalid X-GitHub-Delivery");
    }
    if (event === undefined || !EVENT_NAME.test(event)) {
      throw new BadRequestException("Missing or invalid X-GitHub-Event");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      throw new BadRequestException("Body is not valid JSON");
    }
    const envelope = WebhookEnvelopeSchema.safeParse(payload);
    const meta = envelope.success ? envelope.data : {};

    try {
      await this.db.webhookDelivery.create({
        data: {
          deliveryId,
          event,
          action: meta.action ?? null,
          installationId: meta.installation ? BigInt(meta.installation.id) : null,
          repositoryId: meta.repository ? BigInt(meta.repository.id) : null,
          payload: payload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(200).json({ status: "duplicate" });
        return;
      }
      throw error;
    }

    try {
      await this.jobs.enqueueDelivery(deliveryId);
    } catch (error) {
      // Stored but not queued: the worker's sweeper re-queues it, so GitHub still gets a success.
      this.logger.error({ err: error, deliveryId }, "Could not enqueue webhook delivery");
    }
    res.status(202).json({ status: "accepted" });
  }
}
