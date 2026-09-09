/**
 * 외주 고객 데이터 접근 계층.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import {parse} from 'yaml';

import {CONFIG, OUTSOURCING} from './paths';
import {readJson, readText, writeJsonLikePython} from './jsonio';
import type {Client, ClientMonth, ClientStatus, ClientSurvey, Deliverable, PackageCatalog} from './clientTypes';

export class ClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const SLUG_RE = /^[a-z0-9가-힣][a-z0-9가-힣-]{0,40}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export function slugOk(slug: string): boolean {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

function requireSlug(slug: string): void {
  if (!slugOk(slug)) {
    throw new ClientError('slug 형식이 올바르지 않습니다.', 400);
  }
}

function requireMonth(month: string): void {
  if (typeof month !== 'string' || !MONTH_RE.test(month)) {
    throw new ClientError('month 형식이 올바르지 않습니다 (YYYY-MM).', 400);
  }
}

function clientJsonPath(slug: string): string {
  requireSlug(slug);
  return path.join(OUTSOURCING, slug, '고객.json');
}

function monthJsonPath(slug: string, month: string): string {
  requireSlug(slug);
  requireMonth(month);
  return path.join(OUTSOURCING, slug, month, '월간.json');
}

export async function loadCatalog(): Promise<PackageCatalog> {
  const abs = path.join(CONFIG, 'packages.yaml');
  const raw = await readText(abs);
  if (raw === null) {
    throw new ClientError('패키지 카탈로그 파일이 없습니다.', 500);
  }
  const data = parse(raw) as PackageCatalog;
  return {
    packages: data.packages ?? [],
    stages: data.stages ?? [],
    notes: data.notes ?? [],
  };
}

function emptySurvey(): ClientSurvey {
  return {
    industry: '',
    main_product: '',
    instagram_url: '',
    external_channels: '',
    key_message: '',
    target: '',
    purpose: '',
    tone: '',
  };
}

function defaultClient(slug: string, name: string): Client {
  const now = new Date().toISOString();
  return {
    slug,
    name,
    contact: {person: '', phone: '', email: '', kakao: ''},
    survey: emptySurvey(),
    package: null,
    contract: {start: '', end: '', status: 'lead', event_price_applied: false, notes: ''},
    profile_setup: {done: false, notes: ''},
    created: now,
    updated: now,
  };
}

interface CurrentMonthSummary {
  month: string;
  stage: number;
  total: number;
  uploaded: number;
}

function currentMonthKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return y + '-' + m;
}

export type ClientWithCurrentMonth = Client & {current_month: CurrentMonthSummary | null};

export async function listClients(): Promise<ClientWithCurrentMonth[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(OUTSOURCING);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const month = currentMonthKey();
  const out: ClientWithCurrentMonth[] = [];
  for (const entry of entries) {
    if (!slugOk(entry)) continue;
    const dir = path.join(OUTSOURCING, entry);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat || !stat.isDirectory()) continue;
    const client = await readJson<Client>(path.join(dir, '고객.json'));
    if (!client) continue;

    let currentMonth: CurrentMonthSummary | null = null;
    const monthData = await readJson<ClientMonth>(path.join(dir, month, '월간.json'));
    if (monthData) {
      currentMonth = {
        month: monthData.month,
        stage: monthData.stage,
        total: monthData.items.length,
        uploaded: monthData.items.filter((it) => it.status === 'uploaded').length,
      };
    }
    out.push({...client, current_month: currentMonth});
  }

  out.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  return out;
}

export async function getClient(slug: string): Promise<Client> {
  const abs = clientJsonPath(slug);
  const client = await readJson<Client>(abs);
  if (!client) {
    throw new ClientError('고객을 찾을 수 없습니다.', 404);
  }
  return client;
}

export async function createClient(input: Partial<Client> & {slug: string; name: string}): Promise<Client> {
  requireSlug(input.slug);
  if (!input.name || typeof input.name !== 'string') {
    throw new ClientError('name이 필요합니다.', 400);
  }
  const abs = clientJsonPath(input.slug);
  const existing = await readJson<Client>(abs);
  if (existing) {
    throw new ClientError('이미 존재하는 고객입니다.', 409);
  }

  const base = defaultClient(input.slug, input.name);
  const client: Client = {
    ...base,
    ...input,
    contact: {...base.contact, ...(input.contact ?? {})},
    survey: {...base.survey, ...(input.survey ?? {})},
    contract: {...base.contract, ...(input.contract ?? {})},
    profile_setup: {...base.profile_setup, ...(input.profile_setup ?? {})},
    created: base.created,
    updated: base.updated,
  };
  await writeJsonLikePython(abs, client);
  return client;
}

export async function updateClient(slug: string, patch: Partial<Client>): Promise<Client> {
  const current = await getClient(slug);
  const updated: Client = {
    ...current,
    ...patch,
    slug: current.slug,
    contact: {...current.contact, ...(patch.contact ?? {})},
    survey: {...current.survey, ...(patch.survey ?? {})},
    contract: {...current.contract, ...(patch.contract ?? {})},
    profile_setup: {...current.profile_setup, ...(patch.profile_setup ?? {})},
    created: current.created,
    updated: new Date().toISOString(),
  };
  await writeJsonLikePython(clientJsonPath(slug), updated);
  return updated;
}

export async function listMonths(slug: string): Promise<string[]> {
  requireSlug(slug);
  const dir = path.join(OUTSOURCING, slug);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const months: string[] = [];
  for (const entry of entries) {
    if (!MONTH_RE.test(entry)) continue;
    const stat = await fs.stat(path.join(dir, entry)).catch(() => null);
    if (!stat || !stat.isDirectory()) continue;
    const exists = await fs.access(path.join(dir, entry, '월간.json')).then(
      () => true,
      () => false,
    );
    if (exists) months.push(entry);
  }
  months.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return months;
}

export async function getMonth(slug: string, month: string): Promise<ClientMonth> {
  const abs = monthJsonPath(slug, month);
  const data = await readJson<ClientMonth>(abs);
  if (!data) {
    throw new ClientError('해당 월 데이터를 찾을 수 없습니다.', 404);
  }
  return data;
}

function defaultMonth(month: string): ClientMonth {
  return {
    month,
    stage: 1,
    items: [],
    report: {done: false, file: null, notes: ''},
    memo: '',
    updated: new Date().toISOString(),
  };
}

export async function upsertMonth(slug: string, month: string, data: Partial<ClientMonth>): Promise<ClientMonth> {
  const abs = monthJsonPath(slug, month);
  const existing = await readJson<ClientMonth>(abs);
  const base = existing ?? defaultMonth(month);
  const updated: ClientMonth = {
    ...base,
    ...data,
    month,
    report: {...base.report, ...(data.report ?? {})},
    items: (data.items as Deliverable[] | undefined) ?? base.items,
    updated: new Date().toISOString(),
  };
  await writeJsonLikePython(abs, updated);
  return updated;
}

export function newDeliverableId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

export type {ClientStatus};
