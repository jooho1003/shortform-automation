import Link from 'next/link';

import {NewClientForm} from '@/components/clients/NewClientForm';
import {listClients, type ClientWithCurrentMonth} from '@/lib/clients';
import type {ClientStatus} from '@/lib/clientTypes';

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

function ClientCard({client}: {client: ClientWithCurrentMonth}) {
  const cm = client.current_month;
  return (
    <Link href={'/clients/' + client.slug} className="card" style={{display: 'flex', flexDirection: 'column', gap: 8}}>
      <div className="row" style={{gap: 6}}>
        <span className={STATUS_BADGE[client.contract.status]}>{STATUS_LABEL[client.contract.status]}</span>
        {client.package ? (
          <span className="badge">
            {client.package.name} · {client.package.monthly_reels}편/월
          </span>
        ) : null}
      </div>
      <div style={{fontWeight: 700, fontSize: 15}}>{client.name}</div>
      <div className="muted" style={{fontSize: 12.5}}>
        {client.contact.person || '담당자 미지정'}
      </div>
      {cm ? (
        <div style={{marginTop: 'auto'}}>
          <div className="steps" title={`${cm.uploaded}/${cm.total} 업로드`}>
            {Array.from({length: Math.max(cm.total, 1)}).map((_, i) => (
              <div key={i} className={'step' + (i < cm.uploaded ? ' done' : '')} />
            ))}
          </div>
          <div className="faint" style={{fontSize: 11.5, marginTop: 4}}>
            {cm.month} · {cm.uploaded}/{cm.total}
          </div>
        </div>
      ) : (
        <div className="faint" style={{fontSize: 11.5, marginTop: 'auto'}}>
          이번 달 데이터 없음
        </div>
      )}
    </Link>
  );
}

export default async function ClientsPage() {
  const clients = await listClients();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>외주</h1>
          <p>고객·패키지·월별 산출물. 데이터는 외주/&lt;고객&gt;/ 폴더의 JSON입니다.</p>
        </div>
        <NewClientForm />
      </div>
      {clients.length === 0 ? (
        <div className="empty">고객이 없습니다. 오른쪽 위에서 새 고객을 만드세요.</div>
      ) : (
        <div className="grid cols-3">
          {clients.map((c) => (
            <ClientCard key={c.slug} client={c} />
          ))}
        </div>
      )}
    </>
  );
}
