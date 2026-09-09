'use client';

import {useRouter} from 'next/navigation';
import {useState} from 'react';

import {api} from '@/lib/client';
import type {Client, ClientPackage, ClientStatus, ClientSurvey, PackageCatalog} from '@/lib/clientTypes';

const SURVEY_FIELDS: {key: keyof ClientSurvey; label: string}[] = [
  {key: 'industry', label: '업종/서비스 분야'},
  {key: 'main_product', label: '대표 상품 또는 핵심 서비스'},
  {key: 'instagram_url', label: '현재 운영 중인 인스타그램 계정 URL'},
  {key: 'external_channels', label: '운영 중인 외부 채널 링크'},
  {key: 'key_message', label: '어필하고 싶은 핵심 메시지 및 강점'},
  {key: 'target', label: '타깃 고객층(성별/연령대/주요 니즈)'},
  {key: 'purpose', label: '계정 운영 목적'},
  {key: 'tone', label: '지향하는 콘텐츠 방향 또는 톤앤매너'},
];

const STATUS_OPTIONS: {value: ClientStatus; label: string}[] = [
  {value: 'lead', label: '리드'},
  {value: 'contracted', label: '계약'},
  {value: 'active', label: '진행중'},
  {value: 'paused', label: '일시중지'},
  {value: 'ended', label: '종료'},
];

export function ClientEditor({client, catalog}: {client: Client; catalog: PackageCatalog}) {
  const router = useRouter();
  const [form, setForm] = useState<Client>(client);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (updater: (prev: Client) => Client) => {
    setForm(updater);
    setDirty(true);
  };

  const setContact = (key: keyof Client['contact'], value: string) =>
    patch((prev) => ({...prev, contact: {...prev.contact, [key]: value}}));

  const setSurvey = (key: keyof ClientSurvey, value: string) =>
    patch((prev) => ({...prev, survey: {...prev.survey, [key]: value}}));

  const setContract = (key: keyof Client['contract'], value: string | boolean) =>
    patch((prev) => ({...prev, contract: {...prev.contract, [key]: value}}));

  const setProfileSetup = (key: keyof Client['profile_setup'], value: string | boolean) =>
    patch((prev) => ({...prev, profile_setup: {...prev.profile_setup, [key]: value}}));

  const setPackage = (id: string) => {
    const pkg: ClientPackage | null = catalog.packages.find((p) => p.id === id) ?? null;
    patch((prev) => ({...prev, package: pkg}));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/clients/' + client.slug, {method: 'PUT', json: form});
      setDirty(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 18}}>
      <div className="card">
        <h3 style={{marginTop: 0}}>기본 정보</h3>
        <div className="grid" style={{gridTemplateColumns: '1fr 1fr', gap: 10}}>
          <div>
            <label className="lbl">업체명</label>
            <input className="field" value={form.name} onChange={(e) => patch((prev) => ({...prev, name: e.target.value}))} />
          </div>
          <div>
            <label className="lbl">담당자</label>
            <input className="field" value={form.contact.person} onChange={(e) => setContact('person', e.target.value)} />
          </div>
          <div>
            <label className="lbl">연락처</label>
            <input className="field" value={form.contact.phone} onChange={(e) => setContact('phone', e.target.value)} />
          </div>
          <div>
            <label className="lbl">이메일</label>
            <input className="field" value={form.contact.email} onChange={(e) => setContact('email', e.target.value)} />
          </div>
          <div>
            <label className="lbl">카카오</label>
            <input className="field" value={form.contact.kakao} onChange={(e) => setContact('kakao', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{marginTop: 0}}>사전설문</h3>
        <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
          {SURVEY_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="lbl">{f.label}</label>
              <textarea className="field" rows={2} value={form.survey[f.key]} onChange={(e) => setSurvey(f.key, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 style={{marginTop: 0}}>계약</h3>
        <div className="grid" style={{gridTemplateColumns: '1fr 1fr', gap: 10}}>
          <div>
            <label className="lbl">시작</label>
            <input className="field" type="date" value={form.contract.start} onChange={(e) => setContract('start', e.target.value)} />
          </div>
          <div>
            <label className="lbl">종료</label>
            <input className="field" type="date" value={form.contract.end} onChange={(e) => setContract('end', e.target.value)} />
          </div>
          <div>
            <label className="lbl">상태</label>
            <select className="field" value={form.contract.status} onChange={(e) => setContract('status', e.target.value as ClientStatus)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{alignItems: 'center', marginTop: 20}}>
            <input
              type="checkbox"
              id="event-price"
              checked={form.contract.event_price_applied}
              onChange={(e) => setContract('event_price_applied', e.target.checked)}
            />
            <label htmlFor="event-price" style={{fontSize: 13}}>
              이벤트 특가 적용
            </label>
          </div>
          <div style={{gridColumn: '1 / -1'}}>
            <label className="lbl">메모</label>
            <textarea className="field" rows={2} value={form.contract.notes} onChange={(e) => setContract('notes', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{marginTop: 0}}>패키지</h3>
        <label className="lbl">선택</label>
        <select className="field" value={form.package?.id ?? ''} onChange={(e) => setPackage(e.target.value)} style={{maxWidth: 260}}>
          <option value="">선택 안 함</option>
          {catalog.packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {form.package ? (
          <dl className="kv" style={{marginTop: 14}}>
            <dt>기획</dt>
            <dd>{form.package.monthly_reels}편</dd>
            <dt>편집</dt>
            <dd>{form.package.monthly_edits}편</dd>
            <dt>업로드</dt>
            <dd>{form.package.monthly_uploads}편</dd>
            <dt>소통</dt>
            <dd>{form.package.community_mgmt ? 'O' : 'X'}</dd>
            <dt>해시태그</dt>
            <dd>{form.package.hashtag_setup ? 'O' : 'X'}</dd>
            <dt>프로필 세팅</dt>
            <dd>{form.package.profile_setup ? 'O' : 'X'}</dd>
            <dt>정상가</dt>
            <dd>{form.package.price.toLocaleString()}원</dd>
            <dt>특가</dt>
            <dd>{form.package.event_price.toLocaleString()}원</dd>
          </dl>
        ) : (
          <p className="faint">선택된 패키지가 없습니다.</p>
        )}
      </div>

      <div className="card">
        <h3 style={{marginTop: 0}}>프로필 세팅</h3>
        <div className="row" style={{alignItems: 'center'}}>
          <input
            type="checkbox"
            id="profile-done"
            checked={form.profile_setup.done}
            onChange={(e) => setProfileSetup('done', e.target.checked)}
          />
          <label htmlFor="profile-done" style={{fontSize: 13}}>
            완료
          </label>
        </div>
        <label className="lbl" style={{marginTop: 10}}>
          메모
        </label>
        <textarea className="field" rows={2} value={form.profile_setup.notes} onChange={(e) => setProfileSetup('notes', e.target.value)} />
      </div>

      <div className="row">
        <button className="btn primary" disabled={busy} onClick={save}>
          저장
        </button>
        {dirty ? <span className="badge warn">저장 안 됨</span> : null}
        {error ? <span className="badge danger">{error}</span> : null}
      </div>
    </div>
  );
}
