import Link from 'next/link';

import {ClientEditor} from '@/components/clients/ClientEditor';
import {MonthBoard} from '@/components/clients/MonthBoard';
import {getClient, getMonth, listMonths, loadCatalog} from '@/lib/clients';
import type {ClientMonth, ClientStatus} from '@/lib/clientTypes';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<ClientStatus, string> = {
  lead: 'badge',
  contracted: 'badge info',
  active: 'badge ok',
  paused: 'badge warn',
  ended: 'badge faint',
};

const STATUS_LABEL: Record<ClientStatus, string> = {
  lead: '리드',
  contracted: '계약',
  active: '진행중',
  paused: '일시중지',
  ended: '종료',
};

function currentMonthKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return y + '-' + m;
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{slug: string}>;
  searchParams: Promise<{tab?: string; month?: string}>;
}) {
  const {slug: rawSlug} = await params;
  const slug = decodeURIComponent(rawSlug);
  const sp = await searchParams;
  const tab = sp.tab === 'months' ? 'months' : 'survey';

  let client;
  try {
    client = await getClient(slug);
  } catch {
    return (
      <div className="empty">
        고객을 찾을 수 없습니다. <Link href="/clients">목록으로</Link>
      </div>
    );
  }

  const [months, catalog] = await Promise.all([listMonths(slug), loadCatalog()]);
  const current = currentMonthKey();
  const activeMonth = sp.month ?? current;

  let monthData: ClientMonth | null = null;
  try {
    monthData = await getMonth(slug, activeMonth);
  } catch {
    monthData = null;
  }

  const monthOptions = Array.from(new Set([...months, current])).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  return (
    <>
      <div className="page-head">
        <div>
          <p className="faint" style={{marginBottom: 6}}>
            <Link href="/clients">← 외주</Link>
          </p>
          <h1>{client.name}</h1>
          <div className="row" style={{marginTop: 6}}>
            <span className={STATUS_BADGE[client.contract.status]}>{STATUS_LABEL[client.contract.status]}</span>
            {client.package ? <span className="badge">{client.package.name}</span> : <span className="badge faint">패키지 미지정</span>}
          </div>
        </div>
      </div>

      <div className="tabs">
        <Link href={`/clients/${slug}?tab=survey`} className={tab === 'survey' ? 'active' : ''}>
          설문·계약
        </Link>
        <Link href={`/clients/${slug}?tab=months`} className={tab === 'months' ? 'active' : ''}>
          월별 보드
        </Link>
      </div>

      {tab === 'survey' ? (
        <ClientEditor client={client} catalog={catalog} />
      ) : (
        <>
          <div className="row" style={{marginBottom: 16}}>
            {monthOptions.map((m) => (
              <Link key={m} href={`/clients/${slug}?tab=months&month=${m}`} className={'btn sm' + (m === activeMonth ? ' primary' : '')}>
                {m}
              </Link>
            ))}
          </div>
          <MonthBoard slug={slug} month={activeMonth} data={monthData} stages={catalog.stages} packageInfo={client.package} />
        </>
      )}
    </>
  );
}
