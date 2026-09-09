import {Doctor} from '@/components/Doctor';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>환경 점검</h1>
          <p>이 PC에서 파이프라인이 돌 수 있는지 확인합니다. 키는 pipeline/.env 파일에 넣으면 됩니다(git에 올라가지 않음).</p>
        </div>
      </div>
      <Doctor />
    </>
  );
}
