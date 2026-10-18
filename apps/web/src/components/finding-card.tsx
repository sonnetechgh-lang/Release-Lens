import type { FindingItem, Statement } from "@releaselens/contracts";
import { Badge, Card, Mono, SeverityBadge } from "./ui";
import { formatUtc } from "@/lib/format";

function Statements({ title, items, hint }: { title: string; items: Statement[]; hint: string }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-4">
      <h4 className="text-sm font-semibold">
        {title} <span className="font-normal text-slate-500">· {hint}</span>
      </h4>
      <ul className="mt-1 space-y-1.5 text-sm">
        {items.map((s, i) => (
          <li key={i} className="leading-relaxed">
            {s.text}
            {s.evidenceIds.length > 0 && (
              <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                {s.evidenceIds.map((id) => (
                  <Mono key={id}>{id.split(":")[0]}</Mono>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FindingCard({ finding }: { finding: FindingItem }) {
  const f = finding;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={f.severity} />
        <Badge className="bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
          {f.confidence} confidence
        </Badge>
        {f.state !== "open" && (
          <Badge className="bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
            {f.state}
          </Badge>
        )}
      </div>
      <h3 className="mt-2 text-base font-semibold">{f.title}</h3>
      <p className="mt-1 text-xs text-slate-500">
        <Mono>
          {f.ruleId} v{f.ruleVersion}
        </Mono>{" "}
        · {f.service.name} in {f.environment.name} · first seen {formatUtc(f.firstDetectedAt)} ·
        last seen {formatUtc(f.lastDetectedAt)}
      </p>

      <Statements title="Facts" hint="observed, with evidence" items={f.facts} />
      <Statements title="Inferences" hint="not proven" items={f.inferences} />

      {f.unknowns.length > 0 && (
        <section className="mt-4">
          <h4 className="text-sm font-semibold">
            Unknowns <span className="font-normal text-slate-500">· could not be checked</span>
          </h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {f.unknowns.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-4">
        <h4 className="text-sm font-semibold">Next steps</h4>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
          {f.nextSteps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </section>
    </Card>
  );
}
