import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { toast } from "sonner";
import {
  estimateSeedanceVideoCost,
  type SeedanceResolution,
} from "@/lib/video-constants";

export const Route = createFileRoute("/_authenticated/usage")({
  component: UsagePage,
  head: () => ({
    meta: [
      { title: "Usage & cost · Webtoon Video Generator" },
      {
        name: "description",
        content:
          "Track estimated Seedance video generation spend by month, resolution and status.",
      },
      { property: "og:title", content: "Usage & cost · Webtoon Video Generator" },
      {
        property: "og:description",
        content: "Estimated video generation cost per month and resolution.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Row = {
  id: string;
  status: string;
  work_label: string | null;
  created_at: string;
  resolution: string | null;
  actual_resolution: string | null;
  duration_seconds: number | null;
  actual_duration_seconds: number | null;
};

const RESOLUTIONS: SeedanceResolution[] = ["480p", "720p", "1080p", "4K"];

function normalizeResolution(v: string | null): SeedanceResolution {
  const s = (v ?? "").toLowerCase();
  if (s.includes("4k") || s.includes("2160")) return "4K";
  if (s.includes("1080")) return "1080p";
  if (s.includes("480")) return "480p";
  return "720p";
}

function usd(n: number) {
  return `$${n.toFixed(2)}`;
}

/** Rough encoded bitrate (MB per second of video) used to estimate stored size. */
const MB_PER_SECOND: Record<SeedanceResolution, number> = {
  "480p": 0.35,
  "720p": 0.75,
  "1080p": 1.6,
  "4K": 5.5,
};

/** Lovable Cloud / Supabase storage rate, USD per GB per month. */
const STORAGE_USD_PER_GB_MONTH = 0.021;


function UsagePage() {
  const { t } = useTranslation();
  const { tenantId } = useTenant();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("video_generations")
        .select(
          "id, status, work_label, created_at, resolution, actual_resolution, duration_seconds, actual_duration_seconds",
        )
        .order("created_at", { ascending: false })
        .limit(1000);
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        setRows([]);
        return;
      }
      setRows((data ?? []) as Row[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    const billable = list.filter((r) => r.status === "succeeded");
    const cost = (r: Row) =>
      estimateSeedanceVideoCost(
        normalizeResolution(r.actual_resolution ?? r.resolution),
        r.actual_duration_seconds ?? r.duration_seconds ?? 5,
      );

    const totalCost = billable.reduce((s, r) => s + cost(r), 0);
    const totalSeconds = billable.reduce(
      (s, r) => s + (r.actual_duration_seconds ?? r.duration_seconds ?? 0),
      0,
    );

    const now = new Date();
    const monthKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const thisMonth = monthKey(now);
    const monthCost = billable
      .filter((r) => monthKey(new Date(r.created_at)) === thisMonth)
      .reduce((s, r) => s + cost(r), 0);

    const byMonth = new Map<string, { count: number; cost: number }>();
    for (const r of billable) {
      const k = monthKey(new Date(r.created_at));
      const cur = byMonth.get(k) ?? { count: 0, cost: 0 };
      cur.count += 1;
      cur.cost += cost(r);
      byMonth.set(k, cur);
    }

    const byResolution = RESOLUTIONS.map((res) => {
      const items = billable.filter(
        (r) => normalizeResolution(r.actual_resolution ?? r.resolution) === res,
      );
      return {
        res,
        count: items.length,
        cost: items.reduce((s, r) => s + cost(r), 0),
      };
    }).filter((x) => x.count > 0);

    const items = billable.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      label: r.work_label ?? "-",
      res: normalizeResolution(r.actual_resolution ?? r.resolution),
      seconds: r.actual_duration_seconds ?? r.duration_seconds ?? 5,
      cost: cost(r),
    }));

    const storageGb =
      billable.reduce(
        (s, r) =>
          s +
          MB_PER_SECOND[normalizeResolution(r.actual_resolution ?? r.resolution)] *
            (r.actual_duration_seconds ?? r.duration_seconds ?? 5),
        0,
      ) / 1024;
    const storageCost = storageGb * STORAGE_USD_PER_GB_MONTH;

    return {
      items,
      total: list.length,
      succeeded: billable.length,
      failed: list.filter((r) => r.status === "error" || r.status === "failed").length,
      totalCost,
      monthCost,
      totalSeconds,
      storageGb,
      storageCost,
      byMonth: [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)),
      byResolution: byResolution.sort((a, b) => b.cost - a.cost),
    };

  }, [rows]);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{t("usage.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("usage.subtitle")}</p>
      </header>

      {rows === null ? (
        <p className="text-sm text-muted-foreground">{t("usage.loading")}</p>
      ) : (
        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-3">
            <Card label={t("usage.month_cost")} value={usd(stats.monthCost)} />
            <Card label={t("usage.total_cost")} value={usd(stats.totalCost)} />
            <Card
              label={t("usage.generated")}
              value={`${stats.succeeded} / ${stats.total}`}
              hint={`${Math.round(stats.totalSeconds)}s`}
            />
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              {t("usage.by_month")}
            </h2>
            {stats.byMonth.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("usage.empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {stats.byMonth.map(([month, v]) => (
                  <li key={month} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-muted-foreground">{month}</span>
                    <span className="text-foreground">
                      {v.count} · <strong>{usd(v.cost)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              {t("usage.by_resolution")}
            </h2>
            {stats.byResolution.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("usage.empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {stats.byResolution.map((v) => (
                  <li key={v.res} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-muted-foreground">{v.res}</span>
                    <span className="text-foreground">
                      {v.count} · <strong>{usd(v.cost)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              {t("usage.per_item")}
            </h2>
            {stats.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("usage.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">{t("usage.col_date")}</th>
                      <th className="py-2 pr-3 font-medium">{t("usage.col_label")}</th>
                      <th className="py-2 pr-3 font-medium">{t("usage.col_resolution")}</th>
                      <th className="py-2 pr-3 font-medium">{t("usage.col_duration")}</th>
                      <th className="py-2 text-right font-medium">{t("usage.col_cost")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stats.items.map((it) => (
                      <tr key={it.id}>
                        <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                          {new Date(it.created_at).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 text-foreground">{it.label}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{it.res}</td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {Math.round(Number(it.seconds))}s
                        </td>
                        <td className="py-2 text-right font-semibold text-foreground">
                          {usd(it.cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border">
                      <td className="py-2 pr-3 font-semibold text-foreground" colSpan={4}>
                        {t("usage.sum")}
                      </td>
                      <td className="py-2 text-right text-base font-bold text-primary">
                        {usd(stats.totalCost)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              {t("usage.other_title")}
            </h2>
            <ul className="divide-y divide-border">
              <li className="flex items-start justify-between gap-4 py-3 text-sm">
                <span>
                  <span className="block text-foreground">{t("usage.storage")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t("usage.storage_hint")} · {stats.storageGb.toFixed(2)} GB
                  </span>
                </span>
                <strong className="whitespace-nowrap text-foreground">
                  {usd(stats.storageCost)}
                </strong>
              </li>
              <li className="flex items-start justify-between gap-4 py-3 text-sm">
                <span>
                  <span className="block text-foreground">{t("usage.gateway")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t("usage.gateway_hint")}
                  </span>
                </span>
                <strong className="whitespace-nowrap text-muted-foreground">
                  {t("usage.gateway_value")}
                </strong>
              </li>
              <li className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="font-semibold text-foreground">
                  {t("usage.grand_total")}
                </span>
                <strong className="whitespace-nowrap text-base text-primary">
                  {usd(stats.monthCost + stats.storageCost)}
                </strong>
              </li>
            </ul>
          </section>

          <p className="text-xs text-muted-foreground">{t("usage.disclaimer")}</p>
          <p className="text-xs text-muted-foreground">{t("usage.rate_note")}</p>
          <p className="text-xs text-muted-foreground">{t("usage.storage_note")}</p>


        </div>
      )}
    </main>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
