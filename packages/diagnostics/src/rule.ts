export const SEVERITIES = ["info", "warning", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CONFIDENCES = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/**
 * A diagnostic rule is a pure function from an evidence snapshot to findings.
 * The snapshot and finding shapes are defined in Phase 1; rules stay generic
 * over them so the registry does not depend on provider code.
 */
export interface Rule<TSnapshot, TFinding> {
  /** Stable identifier, for example `deployment.stale`. */
  readonly id: string;
  /** Bumped whenever the rule's logic changes, so findings stay reproducible. */
  readonly version: number;
  readonly description: string;
  evaluate(snapshot: TSnapshot): readonly TFinding[];
}

const RULE_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;

export class RuleRegistry<TSnapshot, TFinding> {
  readonly #rules = new Map<string, Rule<TSnapshot, TFinding>>();

  register(rule: Rule<TSnapshot, TFinding>): this {
    if (!RULE_ID_PATTERN.test(rule.id)) {
      throw new Error(
        `Invalid rule id "${rule.id}": use dotted lowercase, e.g. "deployment.stale"`,
      );
    }
    if (!Number.isInteger(rule.version) || rule.version < 1) {
      throw new Error(`Rule "${rule.id}" must have a positive integer version`);
    }
    if (this.#rules.has(rule.id)) {
      throw new Error(`Rule "${rule.id}" is already registered`);
    }
    this.#rules.set(rule.id, rule);
    return this;
  }

  list(): readonly Rule<TSnapshot, TFinding>[] {
    return [...this.#rules.values()];
  }

  /** Runs every rule, in registration order, against the same snapshot. */
  evaluate(snapshot: TSnapshot): TFinding[] {
    return this.list().flatMap((rule) => rule.evaluate(snapshot));
  }
}
