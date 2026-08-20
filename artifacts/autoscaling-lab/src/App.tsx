import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Activity, AlertTriangle, BookOpen, Check, ChevronRight, CircleHelp, Clock3, Cpu, Database, Gauge, History, Info, Layers3, Link2, ListRestart, Play, RefreshCw, Server, Settings2, ShieldCheck, Sparkles, Terminal, Trash2, Wifi, WifiOff, X } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const STORAGE_KEY = 'autoscaling-lab-request-history';

type ServiceState = 'loading' | 'live' | 'unavailable';
type WorkKind = 'cpu' | 'work';

type HistoryItem = {
  id: string;
  kind: WorkKind;
  duration: number;
  startedAt: string;
  elapsedMs?: number;
  status: 'success' | 'error';
  result?: unknown;
  error?: string;
};

type ServiceInfo = {
  root?: unknown;
  health?: unknown;
  info?: unknown;
  rootStatus?: number;
  healthStatus?: number;
  infoStatus?: number;
};

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

async function readResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function getEndpoint(path: string) {
  const response = await fetch(apiUrl(path), { method: 'GET', credentials: 'include' });
  const data = await readResponse(response);
  if (!response.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  return { data, status: response.status };
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

function formatValue(value: unknown, compact = false): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(value, null, compact ? 0 : 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFlaskServiceRoot(value: unknown) {
  return (
    isRecord(value) &&
    value.service === 'kubernetes-autoscaling-demo' &&
    value.status === 'healthy'
  );
}

function isHealthyResponse(value: unknown) {
  return isRecord(value) && value.status === 'healthy';
}

function isFlaskServiceInfo(value: unknown) {
  return (
    isRecord(value) &&
    value.service === 'kubernetes-autoscaling-demo' &&
    typeof value.hostname === 'string'
  );
}

function loadHistory(): HistoryItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function StatusDot({ state }: { state: ServiceState }) {
  return <span className={`inline-block size-2 rounded-full ${state === 'live' ? 'bg-primary pulse-dot' : state === 'loading' ? 'bg-accent pulse-dot' : 'bg-destructive'}`} />;
}

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Activity }) {
  return (
    <div className="border-l border-border pl-4">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        <Icon className="size-3.5 text-primary" strokeWidth={1.8} />
        {label}
      </div>
      <div className="font-mono-lab text-xl font-bold tracking-tight text-foreground">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>
    </div>
  );
}

function SectionLabel({ index, children }: { index: string; children: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.19em] text-muted-foreground">
      <span className="font-mono-lab text-primary">{index}</span>
      <span className="h-px w-8 bg-primary/40" />
      <span>{children}</span>
    </div>
  );
}

function DataPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'teal' | 'amber' | 'red' }) {
  const toneClass = tone === 'teal' ? 'border-primary/30 bg-primary/10 text-primary' : tone === 'amber' ? 'border-accent/40 bg-accent/15 text-amber-900' : tone === 'red' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-border bg-background/70 text-muted-foreground';
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono-lab text-[10px] font-bold uppercase tracking-[0.08em] ${toneClass}`}>{children}</span>;
}

function Dashboard() {
  const [serviceState, setServiceState] = useState<ServiceState>('loading');
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo>({});
  const [checking, setChecking] = useState(false);
  const [duration, setDuration] = useState(5);
  const [busyKind, setBusyKind] = useState<WorkKind | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [selectedResult, setSelectedResult] = useState<HistoryItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const persistHistory = useCallback((items: HistoryItem[]) => {
    setHistory(items);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, []);

  const refreshService = useCallback(async () => {
    setChecking(true);
    setServiceState('loading');
    try {
      const responses = await Promise.allSettled([getEndpoint('/'), getEndpoint('/health'), getEndpoint('/info')]);
      const [root, health, info] = responses;
      const available =
        root.status === 'fulfilled' &&
        health.status === 'fulfilled' &&
        info.status === 'fulfilled' &&
        isFlaskServiceRoot(root.value.data) &&
        isHealthyResponse(health.value.data) &&
        isFlaskServiceInfo(info.value.data);
      setServiceState(available ? 'live' : 'unavailable');
      setServiceInfo({
        root: root.status === 'fulfilled' ? root.value.data : undefined,
        health: health.status === 'fulfilled' ? health.value.data : undefined,
        info: info.status === 'fulfilled' ? info.value.data : undefined,
        rootStatus: root.status === 'fulfilled' ? root.value.status : undefined,
        healthStatus: health.status === 'fulfilled' ? health.value.status : undefined,
        infoStatus: info.status === 'fulfilled' ? info.value.status : undefined,
      });
      if (!available) setNotice('The Flask service did not respond. Workload controls remain available for the next live run.');
      else setNotice(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refreshService();
  }, [refreshService]);

  const runWorkload = async (kind: WorkKind) => {
    setBusyKind(kind);
    setNotice(null);
    const startedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const response = await getEndpoint(`/${kind}?duration=${duration}`);
      const item: HistoryItem = {
        id: `${kind}-${Date.now()}`,
        kind,
        duration,
        startedAt,
        elapsedMs: Math.round(performance.now() - started),
        status: 'success',
        result: response.data,
      };
      persistHistory([item, ...history].slice(0, 18));
      setSelectedResult(item);
      setNotice(`${kind === 'cpu' ? 'CPU burn' : 'Request-scoped work'} completed and was recorded locally.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The request failed before a response was received.';
      const item: HistoryItem = { id: `${kind}-${Date.now()}`, kind, duration, startedAt, elapsedMs: Math.round(performance.now() - started), status: 'error', error: message };
      persistHistory([item, ...history].slice(0, 18));
      setSelectedResult(item);
      setNotice('Execution failed. The service may be offline or the workload endpoint may be unavailable.');
      setServiceState('unavailable');
    } finally {
      setBusyKind(null);
    }
  };

  const clearHistory = () => {
    persistHistory([]);
    setSelectedResult(null);
    setNotice('Browser-local request history cleared.');
  };

  const infoEntries = useMemo(() => {
    if (isRecord(serviceInfo.info)) return Object.entries(serviceInfo.info).slice(0, 8);
    return [];
  }, [serviceInfo.info]);
  const latest = history[0];
  const completedCount = history.filter((entry) => entry.status === 'success').length;
  const serviceStateLabel = serviceState === 'live' ? 'Live service' : serviceState === 'loading' ? 'Checking service' : 'Service unavailable';

  return (
    <div className="lab-shell min-h-[100dvh] bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[240px] flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-[76px] items-center gap-3 border-b border-sidebar-border px-6">
          <div className="grid size-8 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Gauge className="size-[18px]" strokeWidth={2.4} />
          </div>
          <div>
            <div className="font-mono-lab text-[13px] font-bold tracking-[0.08em]">AUTOSCALING</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/55">Research console</div>
          </div>
        </div>
        <div className="flex-1 px-4 py-8">
          <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-sidebar-foreground/40">Bench / 01</div>
          <div className="flex items-center gap-3 rounded-md bg-sidebar-accent px-3 py-3 text-sm font-semibold text-sidebar-accent-foreground">
            <Activity className="size-4 text-sidebar-primary" />
            Execution bench
            <ChevronRight className="ml-auto size-3.5 text-sidebar-foreground/40" />
          </div>
          <div className="mt-2 flex items-center gap-3 rounded-md px-3 py-3 text-sm text-sidebar-foreground/58">
            <History className="size-4" />
            Browser history
          </div>
          <div className="mt-8 mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-sidebar-foreground/40">Protocol</div>
          <div className="space-y-1 text-[12px] leading-5 text-sidebar-foreground/58">
            <div className="flex gap-2 px-3 py-2"><span className="font-mono-lab text-sidebar-primary">01</span> Generate deterministic load</div>
            <div className="flex gap-2 px-3 py-2"><span className="font-mono-lab text-sidebar-primary">02</span> Observe returned details</div>
            <div className="flex gap-2 px-3 py-2"><span className="font-mono-lab text-sidebar-primary">03</span> Compare, do not mutate</div>
          </div>
        </div>
        <div className="border-t border-sidebar-border p-5">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.17em] text-sidebar-foreground/45"><ShieldCheck className="size-3.5 text-sidebar-primary" /> Guardrail active</div>
          <p className="text-[11px] leading-5 text-sidebar-foreground/60">LLM reasoning is advisory only. HPA owns real scaling decisions.</p>
        </div>
      </aside>

      <main className="lg:pl-[240px]">
        <header className="sticky top-0 z-10 flex min-h-[76px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-md sm:px-8 lg:px-10">
          <div>
            <div className="font-mono-lab text-[10px] font-bold uppercase tracking-[0.22em] text-primary">LAB / OBS-07</div>
            <div className="mt-1 text-sm font-semibold tracking-tight">Reactive vs explainable autoscaling</div>
          </div>
          <div className="flex items-center gap-3">
            <DataPill tone={serviceState === 'live' ? 'teal' : serviceState === 'unavailable' ? 'red' : 'amber'}><StatusDot state={serviceState} />{serviceStateLabel}</DataPill>
            <button type="button" data-testid="button-refresh-service" onClick={() => void refreshService()} disabled={checking} className="grid size-9 place-items-center rounded-md border border-border bg-card text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-50" aria-label="Refresh service status">
              <RefreshCw className={`size-4 ${checking ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-[1480px] px-5 pb-16 pt-8 sm:px-8 lg:px-10">
          <section className="rise-in mb-8 grid gap-6 xl:grid-cols-[1.3fr_.7fr]">
            <div className="relative overflow-hidden rounded-lg border border-border bg-card p-6 shadow-[0_18px_50px_rgba(35,69,82,.07)] sm:p-9">
              <div className="absolute -right-16 -top-24 size-64 rounded-full border-[32px] border-primary/10" />
              <div className="absolute right-8 top-9 hidden font-mono-lab text-[10px] uppercase tracking-[0.2em] text-primary/70 sm:block">Controlled environment // 2025</div>
              <div className="relative max-w-3xl">
                <div className="mb-6 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary"><span className="h-px w-7 bg-primary" /> Instrument panel</div>
                <h1 className="max-w-2xl text-balance text-4xl font-semibold leading-[1.04] tracking-[-0.045em] text-foreground sm:text-6xl">Observe the decision boundary.</h1>
                <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">Run bounded workloads against the Flask service. See what the system returns, preserve the evidence, and keep infrastructure mutations outside the reasoning loop.</p>
                <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-primary" /> Deterministic inputs</span>
                  <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-accent" /> Observable outputs</span>
                  <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-sidebar" /> No mutation</span>
                </div>
              </div>
            </div>
            <div className="scanline rounded-lg bg-sidebar p-6 text-sidebar-foreground sm:p-7">
              <div className="flex items-center justify-between border-b border-sidebar-border pb-4">
                <span className="font-mono-lab text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-primary">Run ledger</span>
                <Terminal className="size-4 text-sidebar-foreground/50" />
              </div>
              <div className="grid grid-cols-2 gap-6 pt-6">
                <Metric label="Runs stored" value={String(history.length).padStart(2, '0')} detail="browser-local" icon={History} />
                <Metric label="Successful" value={String(completedCount).padStart(2, '0')} detail="responses received" icon={Check} />
              </div>
              <div className="mt-8 border-t border-sidebar-border pt-4">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/45"><Clock3 className="size-3.5" /> Last observation</div>
                <div className="mt-2 font-mono-lab text-xs text-sidebar-foreground/80">{latest ? `${latest.kind.toUpperCase()} / ${formatTime(latest.startedAt)}` : 'Awaiting first run'}</div>
              </div>
            </div>
          </section>

          {notice && (
            <div data-testid="status-notice" className={`rise-in-delay-1 mb-6 flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${serviceState === 'unavailable' && busyKind === null ? 'border-destructive/25 bg-destructive/7 text-destructive' : 'border-primary/25 bg-primary/7 text-foreground'}`}>
              {serviceState === 'unavailable' ? <WifiOff className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0 text-primary" />}
              <span>{notice}</span>
              <button type="button" data-testid="button-dismiss-notice" onClick={() => setNotice(null)} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Dismiss notice"><X className="size-4" /></button>
            </div>
          )}

          <section className="rise-in rise-in-delay-1 mb-10">
            <SectionLabel index="01">Workload controls</SectionLabel>
            <div className="grid gap-5 lg:grid-cols-2">
              <WorkloadCard kind="cpu" duration={duration} onDurationChange={setDuration} busy={busyKind === 'cpu'} onRun={() => void runWorkload('cpu')} />
              <WorkloadCard kind="work" duration={duration} onDurationChange={setDuration} busy={busyKind === 'work'} onRun={() => void runWorkload('work')} />
            </div>
          </section>

          <section className="rise-in rise-in-delay-2 mb-10">
            <SectionLabel index="02">Execution detail</SectionLabel>
            <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
              <div className="min-h-[300px] rounded-lg border border-border bg-card p-5 sm:p-6">
                {selectedResult ? <ResultPanel item={selectedResult} /> : <EmptyResult />}
              </div>
              <ServicePanel state={serviceState} checking={checking} info={serviceInfo} entries={infoEntries} onRefresh={() => void refreshService()} />
            </div>
          </section>

          <section className="rise-in rise-in-delay-3 mb-10">
            <div className="mb-4 flex items-end justify-between gap-4">
              <SectionLabel index="03">Request history</SectionLabel>
              <button type="button" data-testid="button-clear-history" onClick={clearHistory} disabled={history.length === 0} className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="size-3.5" /> Clear local record</button>
            </div>
            <HistoryTable history={history} onSelect={setSelectedResult} />
          </section>

          <BoundaryCard />
        </div>
      </main>
    </div>
  );
}

function WorkloadCard({ kind, duration, onDurationChange, busy, onRun }: { kind: WorkKind; duration: number; onDurationChange: (value: number) => void; busy: boolean; onRun: () => void }) {
  const cpu = kind === 'cpu';
  return (
    <div className={`group rounded-lg border bg-card p-5 transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(35,69,82,.08)] sm:p-6 ${cpu ? 'border-primary/30' : 'border-accent/35'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className={`grid size-11 place-items-center rounded-md ${cpu ? 'bg-primary/12 text-primary' : 'bg-accent/15 text-amber-800'}`}>{cpu ? <Cpu className="size-5" /> : <Layers3 className="size-5" />}</div>
        <DataPill tone={cpu ? 'teal' : 'amber'}>{cpu ? 'CPU-bound' : 'request-scoped'}</DataPill>
      </div>
      <h2 className="mt-5 text-xl font-semibold tracking-tight">{cpu ? 'CPU saturation' : 'Request work'}</h2>
      <p className="mt-2 min-h-[48px] max-w-md text-sm leading-6 text-muted-foreground">{cpu ? 'A deterministic compute loop that creates observable CPU pressure for the service.' : 'A bounded request workload that exercises the application without synthetic infrastructure writes.'}</p>
      <div className="mt-6 flex flex-wrap items-end gap-4">
        <label className="block flex-1" htmlFor={`duration-${kind}`}>
          <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Duration / seconds</span>
          <div className="relative">
            <input id={`duration-${kind}`} data-testid={`input-duration-${kind}`} type="number" min={1} max={60} step={1} value={duration} onChange={(event) => onDurationChange(Math.min(60, Math.max(1, Number(event.target.value) || 1)))} className="h-11 w-full rounded-md border border-input bg-background px-3 font-mono-lab text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" />
            <span className="pointer-events-none absolute right-3 top-3 font-mono-lab text-[11px] text-muted-foreground">SEC</span>
          </div>
        </label>
        <button type="button" data-testid={`button-run-${kind}`} onClick={onRun} disabled={busy} className={`flex h-11 items-center justify-center gap-2 rounded-md px-4 text-xs font-bold uppercase tracking-[0.1em] transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60 ${cpu ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-accent text-accent-foreground hover:bg-accent/90'}`}>
          {busy ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" fill="currentColor" />}
          {busy ? 'Running' : 'Run'}
        </button>
      </div>
    </div>
  );
}

function EmptyResult() {
  return (
    <div data-testid="empty-execution-detail" className="flex min-h-[250px] flex-col items-center justify-center text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full border border-dashed border-primary/35 bg-primary/5 text-primary"><ListRestart className="size-5" /></div>
      <div className="text-sm font-semibold">No execution selected</div>
      <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">Run a bounded workload to inspect its response payload, timing, and returned execution details.</p>
      <div className="mt-5 font-mono-lab text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">Awaiting observation</div>
    </div>
  );
}

function ResultPanel({ item }: { item: HistoryItem }) {
  const successful = item.status === 'success';
  return (
    <div data-testid={`panel-result-${item.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.17em] text-muted-foreground"><Terminal className="size-3.5" /> Returned execution</div>
          <h3 className="mt-2 text-lg font-semibold tracking-tight">{item.kind === 'cpu' ? 'CPU saturation' : 'Request work'} <span className="font-mono-lab text-xs font-normal text-muted-foreground">/ {item.duration}s</span></h3>
        </div>
        <DataPill tone={successful ? 'teal' : 'red'}>{successful ? <Check className="size-3" /> : <AlertTriangle className="size-3" />}{successful ? 'Response received' : 'Request failed'}</DataPill>
      </div>
      <div className="grid grid-cols-2 gap-4 border-b border-border py-5 sm:grid-cols-4">
        <ResultMetric label="started" value={formatTime(item.startedAt)} />
        <ResultMetric label="elapsed" value={`${item.elapsedMs ?? 0} ms`} />
        <ResultMetric label="scope" value={item.kind === 'cpu' ? 'compute' : 'request'} />
        <ResultMetric label="mutations" value="none" />
      </div>
      <div className="pt-5">
        <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground"><span>Response payload</span><span className="font-mono-lab normal-case tracking-normal">GET /{item.kind}?duration={item.duration}</span></div>
        <pre className={`max-h-36 overflow-auto rounded-md border p-4 font-mono-lab text-[11px] leading-5 ${successful ? 'border-primary/20 bg-primary/5 text-foreground' : 'border-destructive/20 bg-destructive/5 text-destructive'}`}>{successful ? formatValue(item.result) : item.error}</pre>
      </div>
    </div>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return <div><div className="font-mono-lab text-[9px] uppercase tracking-[0.13em] text-muted-foreground">{label}</div><div className="mt-1 truncate font-mono-lab text-xs font-bold">{value}</div></div>;
}

function ServicePanel({ state, checking, info, entries, onRefresh }: { state: ServiceState; checking: boolean; info: ServiceInfo; entries: [string, unknown][]; onRefresh: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-sidebar p-5 text-sidebar-foreground sm:p-6">
      <div className="flex items-start justify-between border-b border-sidebar-border pb-5">
        <div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.17em] text-sidebar-primary"><Server className="size-3.5" /> Service telemetry</div><h3 className="mt-2 text-lg font-semibold">Flask runtime</h3></div>
        <DataPill tone={state === 'live' ? 'teal' : state === 'unavailable' ? 'red' : 'amber'}><StatusDot state={state} />{state === 'live' ? 'online' : state === 'loading' ? 'probing' : 'offline'}</DataPill>
      </div>
      {state === 'loading' ? <ServiceSkeleton /> : state === 'unavailable' ? <UnavailablePanel onRefresh={onRefresh} checking={checking} /> : (
        <div className="pt-5">
          <div className="grid grid-cols-3 gap-3">
            <TelemetryValue label="root" value={info.rootStatus ? String(info.rootStatus) : 'OK'} />
            <TelemetryValue label="health" value={info.healthStatus ? String(info.healthStatus) : 'OK'} />
            <TelemetryValue label="info" value={info.infoStatus ? String(info.infoStatus) : 'OK'} />
          </div>
          {entries.length > 0 ? <div className="mt-5 space-y-2 border-t border-sidebar-border pt-4">{entries.map(([key, value]) => <div key={key} className="flex items-center justify-between gap-4 text-xs"><span className="text-sidebar-foreground/55">{key}</span><span className="max-w-[65%] truncate font-mono-lab text-[11px] text-sidebar-foreground/90">{formatValue(value, true)}</span></div>)}</div> : <div className="mt-5 flex items-center gap-2 border-t border-sidebar-border pt-4 text-xs text-sidebar-foreground/55"><CircleHelp className="size-3.5" /> Runtime metadata is not exposed by /info.</div>}
          <div className="mt-5 flex items-center gap-2 text-[10px] uppercase tracking-[0.13em] text-sidebar-foreground/40"><Wifi className="size-3.5 text-sidebar-primary" /> Probed from browser · {API_BASE || 'relative API path'}</div>
        </div>
      )}
    </div>
  );
}

function ServiceSkeleton() {
  return <div className="space-y-4 pt-6"><div className="grid grid-cols-3 gap-3">{[1, 2, 3].map((item) => <div key={item} className="h-14 animate-pulse rounded-md bg-sidebar-accent" />)}</div><div className="h-4 w-3/4 animate-pulse rounded bg-sidebar-accent" /><div className="h-4 w-1/2 animate-pulse rounded bg-sidebar-accent" /></div>;
}

function UnavailablePanel({ onRefresh, checking }: { onRefresh: () => void; checking: boolean }) {
  return <div className="pt-6"><div className="flex items-start gap-3 rounded-md border border-destructive/25 bg-destructive/10 p-4"><WifiOff className="mt-0.5 size-4 shrink-0 text-[#f18a72]" /><div><div className="text-sm font-semibold text-sidebar-foreground">No live telemetry</div><p className="mt-1 text-xs leading-5 text-sidebar-foreground/58">The API did not respond to the last probe. This panel is intentionally showing unavailable, not simulated health.</p></div></div><button type="button" data-testid="button-retry-telemetry" onClick={onRefresh} disabled={checking} className="mt-5 flex items-center gap-2 rounded-md border border-sidebar-border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-sidebar-foreground/75 transition hover:border-sidebar-primary hover:text-sidebar-primary disabled:opacity-50"><RefreshCw className={`size-3.5 ${checking ? 'animate-spin' : ''}`} /> Retry probe</button></div>;
}

function TelemetryValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-sidebar-border bg-sidebar-accent/60 p-3"><div className="font-mono-lab text-[9px] uppercase tracking-[0.14em] text-sidebar-foreground/45">{label}</div><div className="mt-1 flex items-center gap-1.5 font-mono-lab text-sm font-bold text-sidebar-foreground"><span className="size-1.5 rounded-full bg-sidebar-primary" />{value}</div></div>;
}

function HistoryTable({ history, onSelect }: { history: HistoryItem[]; onSelect: (item: HistoryItem) => void }) {
  if (history.length === 0) return <div data-testid="empty-request-history" className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center"><div className="mx-auto mb-3 grid size-10 place-items-center rounded-md bg-muted text-muted-foreground"><History className="size-5" /></div><div className="text-sm font-semibold">No local observations yet</div><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">Successful and failed requests will appear here. Records stay in this browser and are never sent to the service.</p></div>;
  return <div className="overflow-hidden rounded-lg border border-border bg-card"><div className="hidden grid-cols-[1.1fr_1fr_1fr_.7fr_.8fr] gap-4 border-b border-border bg-muted/45 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground md:grid"><span>workload</span><span>started</span><span>request</span><span>elapsed</span><span className="text-right">state</span></div>{history.map((item) => <button type="button" data-testid={`row-history-${item.id}`} key={item.id} onClick={() => onSelect(item)} className="grid w-full grid-cols-2 gap-x-4 gap-y-2 border-b border-border px-5 py-4 text-left transition last:border-b-0 hover:bg-primary/5 md:grid-cols-[1.1fr_1fr_1fr_.7fr_.8fr] md:items-center md:gap-4"><span className="flex items-center gap-2 text-sm font-semibold">{item.kind === 'cpu' ? <Cpu className="size-4 text-primary" /> : <Layers3 className="size-4 text-accent-foreground" />}{item.kind === 'cpu' ? 'CPU saturation' : 'Request work'}<span className="font-mono-lab text-[10px] font-normal text-muted-foreground">{item.duration}s</span></span><span className="font-mono-lab text-[10px] text-muted-foreground">{formatTime(item.startedAt)}</span><span className="font-mono-lab text-[10px] text-muted-foreground">GET /{item.kind}</span><span className="font-mono-lab text-[10px] text-muted-foreground">{item.elapsedMs ?? 0} ms</span><span className="col-span-2 flex justify-start md:col-span-1 md:justify-end"><DataPill tone={item.status === 'success' ? 'teal' : 'red'}>{item.status === 'success' ? 'ok' : 'failed'}</DataPill></span></button>)}</div>;
}

function BoundaryCard() {
  return <section className="rounded-lg border border-primary/25 bg-primary/6 p-5 sm:p-7"><div className="grid gap-6 lg:grid-cols-[.85fr_1.15fr] lg:items-center"><div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-primary"><ShieldCheck className="size-3.5" /> Research boundary</div><h2 className="mt-3 max-w-md text-2xl font-semibold leading-tight tracking-[-0.03em]">Explainability stays on the observation side.</h2></div><div className="grid gap-3 sm:grid-cols-2"><BoundaryItem icon={Gauge} title="HPA / real scaling" copy="The Kubernetes Horizontal Pod Autoscaler remains the only component allowed to mutate replica state." tone="teal" /><BoundaryItem icon={Sparkles} title="LLM / advisory shadow" copy="A reasoning layer may summarize or recommend. It cannot call a scaling API or change infrastructure." tone="amber" /></div></div></section>;
}

function BoundaryItem({ icon: Icon, title, copy, tone }: { icon: typeof Gauge; title: string; copy: string; tone: 'teal' | 'amber' }) {
  return <div className="rounded-md border border-border/80 bg-card/70 p-4"><div className="flex items-center gap-2 text-sm font-semibold"><Icon className={`size-4 ${tone === 'teal' ? 'text-primary' : 'text-accent-foreground'}`} />{title}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">{copy}</p></div>;
}

function AppShell() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Dashboard} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppShell /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;