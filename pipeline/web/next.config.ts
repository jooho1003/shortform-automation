import path from 'node:path';
import type {NextConfig} from 'next';

// 워크스페이스 루트(pipeline/)를 명시한다. remotion/src 컴포지션을 웹앱이 직접 import하므로
// Turbopack이 web/ 밖의 소스를 모듈 그래프에 포함시켜야 한다.
const workspaceRoot = path.resolve(__dirname, '..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
  // Remotion 소스는 트랜스파일 대상. 같은 워크스페이스라 React 인스턴스는 하나다.
  transpilePackages: ['shortform-remotion'],
  experimental: {
    // 잡 러너가 자식 프로세스를 오래 붙들고 있어도 라우트 핸들러가 잘리지 않게
    proxyTimeout: 0,
  },
};

export default nextConfig;
