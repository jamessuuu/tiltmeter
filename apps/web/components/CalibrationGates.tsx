import type { CalibrationResult } from "@/lib/calibration";
import { formatPct } from "@/lib/calibration";

/**
 * The calibration evidence, at last shown rather than summarized
 * (2026-09-07). `/` previously printed two percentages — "0.0%" and
 * "95.0%" — and threw away everything underneath them: how many trials,
 * how many fired, what bar each gate had to clear, and how much margin
 * there was. Those are the numbers that make the percentages mean
 * anything, and every one of them is already sitting in the committed
 * `evals/calibration/results/latest.json` that CI regenerates and fails
 * on drift.
 *
 * Each gate draws its own trials: one cell per trial, so 200 is a shape
 * you can look at rather than a word. The detection-power gate's ten
 * misses are visible as ten quiet cells — a thing a "95.0%" cannot show.
 * Static markup, no client JS; entrance motion is per-row, not per-cell.
 */

interface GateProps {
  label: string;
  /** What the gate had to clear, as prose. */
  bar: string;
  /** Where the bar sits on this gate's 0-100 track. */
  barPct: number;
  /** Where the measurement landed on that same track. */
  achievedPct: number;
  /** Whether the fill runs to the achieved value or the track stays quiet (a ceiling gate that nothing reached). */
  direction: "floor" | "ceiling";
  value: string;
  fires: number;
  trials: number;
  countLabel: string;
  cellsLit: number;
  margin: string;
  riseClass: string;
}

function TrialGrid({ trials, lit, litFirst }: { trials: number; lit: number; litFirst: boolean }) {
  const cells = Array.from({ length: trials }, (_, i) => (litFirst ? i < lit : i >= trials - lit));
  const rows: boolean[][] = [];
  for (let i = 0; i < cells.length; i += 25) rows.push(cells.slice(i, i + 25));
  return (
    <div className="mt-4 flex flex-col gap-[3px]" aria-hidden="true">
      {rows.map((row, r) => (
        <div key={r} className="flex gap-[3px] rise" style={{ animationDelay: `${String(180 + r * 22)}ms` }}>
          {row.map((on, c) => (
            <span
              key={c}
              className={`h-[7px] flex-1 rounded-[1.5px] ${on ? "bg-amber" : "bg-ink/12"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function Gate(props: GateProps) {
  const {
    label,
    bar,
    barPct,
    achievedPct,
    direction,
    value,
    fires,
    trials,
    countLabel,
    cellsLit,
    margin,
    riseClass,
  } = props;
  return (
    <div className={`panel panel-hover p-6 sm:p-7 ${riseClass}`}>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.09em] text-ink/55">{label}</h3>
        <span className="text-[11px] font-mono text-ink/45">n={trials}</span>
      </div>

      <p className="mt-3 flex items-baseline gap-2">
        <span className="font-mono text-6xl font-semibold tracking-[-0.045em] tabular-nums leading-none">
          {value}
        </span>
        <span className="text-sm text-ink/55 tabular-nums">
          {fires}/{trials} {countLabel}
        </span>
      </p>

      <div className="mt-6">
        <div className="meter">
          {direction === "floor" ? (
            <span className="meter-fill" style={{ width: `${String(achievedPct)}%` }} />
          ) : null}
          <span className="meter-notch" style={{ left: `calc(${String(barPct)}% - 1px)` }} />
        </div>
        <div className="mt-2 flex justify-between text-[11px] font-mono text-ink/50">
          <span>{bar}</span>
          <span className="text-ink/70">{margin}</span>
        </div>
      </div>

      <TrialGrid trials={trials} lit={cellsLit} litFirst={direction === "floor"} />
      <p className="mt-3 text-xs text-ink/50">
        {direction === "floor"
          ? `one cell per trial — ${String(trials - cellsLit)} misses shown quiet`
          : `one cell per trial — every one quiet is a trial that did not fire`}
      </p>
    </div>
  );
}

/** SPEC §12's two published bars, as fractions — the numbers each gate had to clear. */
const FALSE_POSITIVE_CEILING = 0.05;
const DETECTION_POWER_FLOOR = 0.9;

/**
 * Distance from a bar, in percentage points, computed — never typed in by
 * hand (a sibling project shipped "152 tests" on a page whose suite ran
 * 159). Phrased by direction rather than sign: a ceiling gate reads
 * "under", a floor gate reads "over", so a good result never renders with
 * a minus in front of it.
 */
function marginPts(rate: number, bar: number, direction: "floor" | "ceiling"): string {
  const pts = Math.abs(rate - bar) * 100;
  return `${pts.toFixed(1)} pts ${direction === "ceiling" ? "under ceiling" : "over floor"}`;
}

/**
 * The hero readout. The fold previously showed a claim and two paragraphs;
 * the evidence for the claim sat a full screen below it, and the right
 * quarter of a 1440 viewport was empty paper. This puts the result itself
 * in that space — the shipgauge shape, where the finding IS the page — and
 * the full trial-by-trial panels below remain the detail behind it.
 */
export function CalibrationReadout({ calibration }: { calibration: CalibrationResult }) {
  const rows = [
    {
      key: "fp",
      label: "False positives",
      value: formatPct(calibration.falsePositive.rate),
      detail: `${String(calibration.falsePositive.fires)}/${String(calibration.falsePositive.trials)} fired`,
      bar: `ceiling ${formatPct(FALSE_POSITIVE_CEILING)}`,
      fillPct: 0,
      notchPct: 50,
      quiet: true,
    },
    {
      key: "dp",
      label: "Detection power",
      value: formatPct(calibration.detectionPower.rate),
      detail: `${String(calibration.detectionPower.fires)}/${String(calibration.detectionPower.trials)} caught`,
      bar: `floor ${formatPct(DETECTION_POWER_FLOOR)}`,
      fillPct: calibration.detectionPower.rate * 100,
      notchPct: DETECTION_POWER_FLOOR * 100,
      quiet: false,
    },
  ];
  return (
    <div className="panel-float p-6 sm:p-7">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/50">
          Calibration
        </span>
        <span className="font-mono text-[11px] text-ink/45">both gates cleared</span>
      </div>
      <dl className="mt-5 flex flex-col gap-6">
        {rows.map((r) => (
          <div key={r.key}>
            <dt className="text-[12px] uppercase tracking-[0.08em] text-ink/55">{r.label}</dt>
            <dd className="mt-1.5 flex items-baseline gap-2.5">
              <span className="font-mono text-[40px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
                {r.value}
              </span>
              <span className="text-[13px] tabular-nums text-ink/55">{r.detail}</span>
            </dd>
            <div className="mt-3 meter">
              {r.fillPct > 0 ? <span className="meter-fill" style={{ width: `${String(r.fillPct)}%` }} /> : null}
              <span className="meter-notch" style={{ left: `calc(${String(r.notchPct)}% - 1px)` }} />
            </div>
            <div className="mt-1.5 font-mono text-[10.5px] text-ink/45">{r.bar}</div>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function CalibrationGates({ calibration }: { calibration: CalibrationResult }) {
  const fp = calibration.falsePositive;
  const dp = calibration.detectionPower;
  return (
    <div className="grid gap-5 sm:grid-cols-2" data-testid="calibration-numbers">
      <Gate
        label="False positives"
        bar={`ceiling ${formatPct(FALSE_POSITIVE_CEILING)}`}
        barPct={50}
        achievedPct={(fp.rate / (FALSE_POSITIVE_CEILING * 2)) * 100}
        direction="ceiling"
        value={formatPct(fp.rate)}
        fires={fp.fires}
        trials={fp.trials}
        countLabel="fired"
        cellsLit={fp.fires}
        margin={marginPts(fp.rate, FALSE_POSITIVE_CEILING, "ceiling")}
        riseClass="rise rise-3"
      />
      <Gate
        label="Detection power"
        bar={`floor ${formatPct(DETECTION_POWER_FLOOR)}`}
        barPct={DETECTION_POWER_FLOOR * 100}
        achievedPct={dp.rate * 100}
        direction="floor"
        value={formatPct(dp.rate)}
        fires={dp.fires}
        trials={dp.trials}
        countLabel="caught"
        cellsLit={dp.fires}
        margin={marginPts(dp.rate, DETECTION_POWER_FLOOR, "floor")}
        riseClass="rise rise-4"
      />
    </div>
  );
}
