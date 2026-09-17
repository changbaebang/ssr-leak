# ssr-leak

Next.js SSR 요청 사이에 새어 나가는 모듈 스코프 상태를 잡아냅니다.

[English README](./README.md)

## 문제

서버에서 모듈은 **한 번** 평가된 뒤 그 프로세스가 처리하는 **모든 요청**이 공유합니다.
모듈 스코프에 쓰는 것 — `axios.defaults`, 공유 axios 인스턴스, 파일 최상단의 `let`, 모듈 레벨 `Map` — 은
다음 요청에서도 그대로 보이며, 그 요청은 다른 사용자의 것일 수 있습니다.

```ts
// lib/api.ts
import axios from 'axios';

export async function getServerSideProps(ctx) {
  // ❌ 요청 A가 자기 토큰을 공유 인스턴스에 씁니다.
  //    2ms 뒤 도착한 요청 B는 A의 Authorization 헤더로 응답을 받습니다.
  axios.defaults.headers.common['Authorization'] = `Bearer ${ctx.req.cookies.token}`;
  const { data } = await axios.get('https://api.acme.test/me');
  return { props: { data } };
}
```

```ts
// ✅ 요청 데이터는 요청 스코프에 둡니다.
export async function getServerSideProps(ctx) {
  const { data } = await axios.get('https://api.acme.test/me', {
    headers: { Authorization: `Bearer ${ctx.req.cookies.token}` },
  });
  return { props: { data } };
}
```

이것은 보안 버그(사용자 간 데이터 노출)입니다. 동시 부하에서는 결정적으로 재현되지만, 사용자 한 명·요청 한 개인
로컬 개발 환경에서는 보이지 않습니다. 이를 겨냥한 주류 린트 규칙이 없어서 `ssr-leak`이라는 작은 정적 검사기를
만들었습니다.

## 하는 일 / 하지 않는 일

**하는 일**

- **함수 본문 안**(즉 요청마다 실행될 수 있는 코드)에서 일어나는 `<axios>.defaults.*` 쓰기,
  `<axios>.interceptors.*.use()`, 모듈 레벨 변수·객체·컬렉션 쓰기, `globalThis` / `process.env` 쓰기를 찾습니다.
- 쓰여지는 값이 요청에서 파생됐는지, 그리고 **오염이 어디서 왔는지**를 추적합니다. 요청 프리미티브(`headers()`,
  `cookies()`, `req.*`, `getServerSideProps` / 라우트 핸들러 등의 파라미터)에서 왔으면 `high`, 그 밖의 함수의
  맨 인자(setter, 구독 함수)에서 왔으면 `medium`입니다. 그래서 기본 출력이 짧고 실행 가능한 항목만 남습니다.
- TypeScript 컴파일러의 파서만 사용합니다(타입 체커·프로젝트 설정 없음): 파일 1만 개를 몇 초에 처리합니다.
- CLI, 프로그래밍 API, CI용 안정적인 `--json` 형식을 제공합니다.

**하지 않는 일**

- 함수가 SSR 중 실행된다는 것을 증명하지 않습니다. `'use client'`가 없는 모듈은 런타임에 브라우저만 호출하더라도
  분석됩니다. 그런 모듈은 `ignore` 설정이나 억제 주석을 쓰세요.
- `'use client'`를 "서버 코드가 아님"으로 취급하지 않습니다. **Client Component도 요청마다 서버에서 렌더링**되므로
  그 안의 모듈 스코프 쓰기는 다른 파일과 똑같이 누수됩니다. 이런 파일을 기본으로 건너뛰는 이유는 출력을 짧게
  유지하기 위해서일 뿐입니다(대부분 브라우저 전용 이벤트 핸들러). 안전 보장이 아니라 소음 절충이므로 감사 시와
  `app/**` 트리에서는 `--include-client`로 실행하세요.
- 파일 간 값 흐름을 따라가지 않습니다. 다른 모듈에서 만든 공유 인스턴스는 형태(`.defaults.headers`,
  `.interceptors.request.use`)로만 인식합니다.
- `eslint-plugin-react-hooks`, `@next/eslint-plugin-next`, 타입 인식 ESLint 규칙을 대체하지 않습니다. 이들은 다른
  종류의 버그를 잡으며, 어느 것도 "모듈 스코프는 요청 간 공유된다"는 모델을 갖고 있지 않습니다.
- 모듈 스코프에 저장된 클로저(`handlers.push(() => req.user)`)나, 모듈 스코프에 놓인 클래스 인스턴스를 `this`로
  변경하는 경우의 누수는 잡지 못합니다.

## 설치 & 사용

```sh
# 일회성
npx ssr-leak

# 프로젝트에 추가
pnpm add -D ssr-leak
pnpm ssr-leak src app pages lib
```

기본값: 현재 디렉터리 아래 모든 `*.{ts,tsx,js,jsx,mjs,cjs}`. 다음은 건너뜁니다.

- 어디에 있든 이름이 `node_modules`, `dist`, `build`, `out`, `.next`, `.vercel`, `.output`, `.turbo`, `.cache`,
  `.git`, `coverage`, `storybook-static`, `public`, `mocks`, `__mocks__`인 디렉터리(빌드 산출물, 정적 자산,
  캐시, VCS 메타데이터, 목 핸들러) — 설정 파일의 `exclude` / `include`로 바꿀 수 있고, 명령줄에 직접 지정한
  디렉터리는 항상 탐색합니다;
- 선언 파일과 테스트/스토리/목 파일(`*.test.*`, `*.spec.*`, `__tests__/`, `*.stories.*`, `*.mock.*`);
- 압축(minified) 파일: `*.min.js`, 그리고 한 줄이 2000자를 넘는 파일(직접 지정하거나 `include`에 걸리는 파일은
  그래도 분석);
- `'use client'`로 시작하는 파일 — `--include-client`를 주지 않는 한(위 주의 참고).

입력 집합이 비면 오류입니다: 존재하지 않는 경로를 지정했거나 glob이 아무것도 못 찾으면 종료 코드 2를 내서
잘못 설정된 CI 작업이 조용히 통과하지 못하게 합니다. `--allow-empty`를 주면 대신 0으로 끝납니다.

## 요구 사항 & 호환성

실행하기 전에 ssr-leak이 내 프로젝트에 맞는지 이 절로 판단하세요. 모든 행은 테스트 스위트의 픽스처
(`test/fixtures/entries`, `test/fixtures/syntax`, `test/fixtures/r1`…)로 검증했습니다.

### "SSR 진입점"이란

이 도구는 어떤 함수가 SSR 중에 실행된다는 것을 증명하지 않습니다. 이름·export 형태·파일 경로로 고정된
**진입점** 목록을 인식하며, 진입점의 파라미터는 *요청 프리미티브*(R4 `high`)입니다. 나머지 함수도 분석하지만,
인식되지 않은 함수의 맨 파라미터는 `medium`까지만 주고, 요청에서 유래한 값이 없는 쓰기는 R5(`--all`)입니다.

| 프레임워크 / 컨벤션 | 진입점으로 인식 | 비고 |
| --- | --- | --- |
| Next.js Pages Router (9–16) | `getServerSideProps`, `getStaticProps`, `getInitialProps` — 래핑(`export const getServerSideProps = withAuth(async (ctx) => …)`)·대입(`Page.getInitialProps = …`) 포함; 파라미터를 받는 `pages/api/**` 파일의 default export | `getStaticProps`는 요청마다가 아니라 빌드·재검증 시 실행되지만, `params`/`preview` 데이터를 모듈 상태에 쓰면 안 되므로 진입점으로 둡니다. |
| Next.js App Router (13.4–16) | export된 `GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`/`OPTIONS`(export 이름 기준, **어느 파일이든** — `route.ts` 파일명은 필요 없음); 파라미터를 받는 `app/**/page|layout|template|default.*`의 default export; export된 `generateMetadata` / `generateViewport` | `loading`, `error`, `not-found`, `global-error`는 요청 데이터를 받지 않으므로 진입점이 아닙니다(거기서의 맨 prop은 `medium`). `generateStaticParams`는 빌드 타임이라 진입점이 아닙니다. `after()` 콜백은 일반 중첩 함수로 분석합니다. |
| Next.js Server Actions / Server Functions (13.4+) | 디렉티브 프롤로그에 `'use server'`가 있는 파일: **export된** 모든 함수; 첫 문장이 `'use server'`인 함수(중첩 깊이 무관) | `'use server'` 파일의 export되지 않은 함수는 일반 헬퍼입니다. 선언 뒤의 `export { fn }` 목록은 따라가지 않습니다 — `export function` / `export const`를 쓰세요. |
| Next.js middleware / proxy (12.2–16) | export된 `middleware` 또는 `proxy`(어느 파일이든); 파라미터를 받는 `middleware.*` / `proxy.*` 파일의 default export | Next 16에서 `middleware.ts`가 `proxy.ts`로, 함수도 `proxy`로 이름이 바뀌었습니다. 두 표기 모두 인식합니다([Next.js 문서, proxy.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)). |
| Next.js `instrumentation.ts` | 진입점 아님 | `register()`는 프로세스당 한 번 실행됩니다. `onRequestError(err, request, ctx)`는 파일이 아니라 `request` / `ctx` 이름 휴리스틱으로 잡힙니다. |
| Remix / React Router (framework mode) | 첫 파라미터가 `request`, `params`, `context`를 구조 분해하는 export된 `loader` / `action`(`export async function loader({ request, params }) …`) | 구조 분해된 파라미터도 분석기에는 일반 파라미터이므로 안에서의 `request.url`은 `high`입니다. 그런 파라미터가 없는 export된 `loader`는 건드리지 않습니다. `clientLoader` / `clientAction`은 진입점이 아닙니다. |
| 모든 Node 서버 코드 (Express, Fastify, Koa, Hono, Nitro, Vite SSR, 직접 만든 `server.ts`) | 진입점 없음; 오염 **이름 휴리스틱**이 적용됩니다: `req`, `request`, `ctx`, `context`(그리고 요청스러운 멤버를 읽는 `params`, `searchParams`, `event`)에 대한 프로퍼티 읽기는 어디서든 요청 프리미티브라서 `(req, res) => { last = req.headers.host }`는 R4 `high` | 자기 이름(`c.req`, `getSession()`)은 설정의 `taintSources.identifiers` / `taintSources.functions`로 확장하세요. 파라미터 이름이 `foo`인 핸들러는 `medium`입니다. |
| Nuxt / SvelteKit / Astro / Vue SFC / Angular | 미지원 | `.vue`, `.svelte`, `.astro` 파일은 파싱하지 않습니다. 그런 프로젝트의 순수 `.ts` 서버 유틸리티는 이름 휴리스틱만으로 분석됩니다. |

### HTTP 클라이언트

| 형태 | R1 / R2 / R3 |
| --- | --- |
| `import axios from 'axios'`, `import * as axios from 'axios'`(`axios.default.defaults`), `import axios = require('axios')`, `const axios = require('axios')` | 예 |
| `axios.create(…)`, `import { create } from 'axios'` / `const { create } = require('axios')`의 `create(…)` — 모듈 레벨 바인딩에 대입된 경우 | 예 |
| 다른 모듈에서 import한 인스턴스(`import { api } from './client'`) | `api.defaults.headers…` → R1; `api.interceptors.request.use(…)` → R3; `api.defaults.baseURL = …` → 값이 오염됐으면 R4, 아니면 R5(`--all`) |
| 함수 안에서 만든 인스턴스(핸들러 안의 `const api = axios.create()`) | 발견 아님(요청별 인스턴스) |
| 나중에 대입되는 모듈 레벨 `let`의 인스턴스(`let api; function init() { api = axios.create() }`) | 대입은 R4/R5; 이후의 `api.defaults` 쓰기는 R1이 아님 |
| `axios-retry`, `interceptors.eject`, `interceptors.clear` | `axiosRetry(axios, …)`는 일반 호출(발견 아님). 같은 함수에서 등록하고 eject하는 인터셉터는 R3가 아닙니다. |
| `ky`, `got`, `superagent`, `fetch` 래퍼, `ofetch`, GraphQL 클라이언트 | HTTP 클라이언트로 인식하지 않습니다. 그 모듈 레벨 인스턴스에 대한 쓰기는 여전히 R4(오염)/R5라서 `k.defaults = req.x`는 보고되지만, "요청마다 인스턴스 생성"은 이해하지 못합니다. |

### 언어, 문법, 파일

- **확장자**: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`. `.d.ts`는 건너뜁니다. `.js`는 JSX를 켠 채로
  파싱하므로(TypeScript 파서의 JS 모드) `.js` 안의 React 코드도 동작합니다.
- **문법**: TypeScript 5.x가 파싱하는 전부 — 데코레이터(legacy·표준), `satisfies`, `using`, `enum` / `namespace`,
  클래스 필드와 `accessor`, `export =`, `import x = require()`, CommonJS `module.exports`. Flow, Vue/Svelte/Astro
  단일 파일 컴포넌트는 안 됩니다.
- **문법 오류**가 있어도 실행은 멈추지 않습니다. TypeScript 파서가 복구하며, 파싱된 데까지 분석하고 `parse-error`
  진단을 보고합니다("실패하는 방식" 참고).
- **모듈 시스템**: ESM과 CommonJS. `require('axios')`, `const { create } = require('axios')`를 인식합니다. 동적
  `import()` 결과는 추적하지 않습니다.
- **설정 파일**: `--root`의 `ssr-leak.config.json` / `.mjs` / `.js` / `.cjs`(먼저 찾은 것), 또는 `--config <path>`.
  키: `ignore`, `exclude`, `include`(glob / 디렉터리 이름 문자열 배열), `taintSources`(`{ functions?, identifiers? }`),
  `guards`(`{ server?, client? }`). 그 외 키는 설정 오류(종료 코드 2)입니다.
- **런타임**: Node 20, 22, 24(CI는 20과 22, 개발은 24). Windows는 테스트하지 않았습니다 — 내부에서 경로를 `/`로
  정규화하지만 거기서 도는 CI 작업은 없습니다.
- **규모**: 노트북에서 약 13,600개 파일을 4–5초, RSS 약 260 MB(대형 모노레포, 단일 스레드, 파서만, 타입 체커
  없음). 파일을 하나씩 읽고 파싱하므로 메모리는 발견 목록 외에는 트리 크기에 비례해 늘지 않습니다.

### 탐지하는 것 / 못 하는 것

탐지(정확한 형태는 "규칙" 참고): 모듈 초기화가 아닌 함수 안에서의 `<axios>.defaults.*`,
`<axios>.interceptors.*.use()`, 모듈 레벨 `let` / `var` 재대입, 모듈 레벨 바인딩의 프로퍼티 대입, 모듈 레벨
`Map` / `Set` / `Array` 리터럴에 대한 `set/add/push/…`, `Object.assign(moduleObject, …)`, `globalThis.*` /
`global.*` / `process.env.*` 쓰기 — 쓰인 값의 오염 출처와 함께.

미탐지: **다른 모듈**을 거치는 누수(setter를 export하는 `store.ts` — 그 파일을 분석하세요; 쓰기 지점이 구문상
보여야 합니다), 모듈 스코프에 저장된 클로저, 모듈 스코프에 저장되고 `this`로 변경되는 클래스 인스턴스, 팩토리가
만든 컬렉션(`const cache = createLRU()`), 나중에 axios 인스턴스가 대입되는 모듈 레벨 `let`, 최상위
`app.use(…)`로 등록된 함수(모듈 초기화로 취급), `--include-client` 없는 `'use client'` 파일. "알려진 미탐" 참고.

### 실패하는 방식

CLI는 입력 문제에 스택 트레이스를 찍지 않으며, 모든 메시지는 stderr 한 줄입니다. 깨끗한 실행이 오해를 부를 만한
상황은 전부 종료 코드 2입니다.

| 종료 | 조건 | stderr (접두사) |
| --- | --- | --- |
| 2 | 알 수 없는 옵션 / 잘못된 값 | `error: Unknown option '--x'`, `error: --fail-on must be one of high, medium, low, none (got "x")` |
| 2 | 설정 파일 문제 | `error: config file not found: <path>`, `error: <file>: invalid JSON (…)`, `error: <file>: failed to load (…)`, `error: <file>: unknown key(s) a, b`, `error: <file>: "ignore" must be string[]`, `error: <file>: "taintSources.functions" must be string[]`, `error: <file>: "guards.server" must be string[]` |
| 2 (`--allow-empty`면 0) | 지정한 경로가 없음 | `error: path not found: <pattern> (relative to <root>)` (`missing-path`) |
| 2 (`--allow-empty`면 0) | 분석한 파일이 없음 | `error: no files to analyze: <patterns> matched nothing under <root>` (`empty-input`) |
| 2 (`--allow-empty`면 0) | 분석한 모든 파일에 문법 오류 | `error: no file parsed cleanly: all N analyzed file(s) under <root> have syntax errors` (`empty-input`) |
| 2 | 찾은 파일을 읽을 수 없음 | `error: cannot read <file>: EACCES` (`unreadable-file`) |
| 변화 없음 | 한 파일에 문법 오류가 있지만 다른 파일은 파싱됨 | `warning: syntax error in <file>:<line>:<col>: <message> (+N more); analyzed as far as it parsed` (`parse-error`) |
| 2 | 예기치 않은 예외 | `error: <stack>` — `--env` 출력과 함께 제보해 주세요 |

모든 진단은 `report.diagnostics`(`--json`)에도 `kind`와 함께 들어갑니다. 압축 파일(`*.min.js`, 2000자를 넘는
줄)과 `'use client'` 파일은 조용히 건너뜁니다 — 직접 지정하거나 `include` / `--include-client`를 쓰세요.

`ssr-leak --env`는 제보에 필요한 정보를 출력하고 0으로 종료합니다(설정 파일이 잘못됐으면 2):

```
ssr-leak: 0.2.0
node: v22.12.0 (linux x64)
typescript: 5.9.3
root: /work/app
config file: /work/app/ssr-leak.config.json
default pattern: **/*.{ts,tsx,js,jsx,mjs,cjs}
excluded directories: node_modules, dist, build, out, .next, .vercel, .output, .turbo, .cache, .git, coverage, storybook-static, public, mocks, __mocks__
config ignore: (none)
config include: (none)
server guards: isServer, isSSR, isServerSide
client guards: isClient, isBrowser, isClientSide, canUseDOM
taint functions: headers, cookies, draftMode, getServerSession
taint identifiers: req, request, ctx, context, params, searchParams, event
rules:
  R1 axios-defaults-in-function [high]
  R2 axios-defaults-at-module-scope [low, --all only]
  R3 axios-interceptor-in-request-path [high]
  R4 module-state-write-tainted [high]
  R5 module-state-write-untainted [low, --all only]
  R6 global-object-write [medium]
```

## CLI 옵션

| 옵션 | 설명 |
| --- | --- |
| `[globs...]` | `--root` 기준 glob·디렉터리·파일. `**`, `*`, `?`, `{a,b}` 지원. 디렉터리는 "그 아래 전부"를 뜻합니다. 존재하지 않는 경로는 오류(종료 코드 2). |
| `--root <dir>` | glob, `--config`, 보고 경로의 기준 디렉터리. 기본: 현재 디렉터리. |
| `--all` | 낮은 신뢰도 규칙도 보고: R2 `axios-defaults-at-module-scope`, R5 `module-state-write-untainted`. |
| `--include-client` | 첫 문장이 `'use client'`인 파일도 분석. 감사 시 권장. |
| `--json` | 기계 판독 출력(아래 참고). |
| `--config <path>` | 설정 파일. `--root` 기준으로 해석. 기본: `--root`의 `ssr-leak.config.{json,mjs,js,cjs}`(있을 때). |
| `--fail-on <level>` | `high`(기본), `medium`, `low` 이상 발견이 하나라도 있으면 종료 코드 1; `none`은 절대 실패하지 않음. |
| `--allow-empty` | 분석한 파일이 없거나 지정한 경로가 없을 때 2 대신 0으로 종료. |
| `--env` | 제보용 환경 정보(버전, root, 설정 파일, 기본값, 규칙 목록)를 출력하고 0으로 종료. |
| `-h, --help` / `-v, --version` | 도움말 / 버전. |

## 규칙

| ID | 이름 | 신뢰도 | 기본 | 잡는 것 |
| --- | --- | --- | --- | --- |
| R1 | `axios-defaults-in-function` | high | 켜짐 | 함수 안에서 `<axios>.defaults.*` 대입(또는 `Object.assign`). `<axios>`는 `axios`의 default import, `require('axios')`, `<axios>.create()` 또는 `axios`에서 구조 분해한 `create()`로 초기화된 모듈 레벨 변수, 또는 경로가 `.defaults.headers…`인 import 바인딩. |
| R2 | `axios-defaults-at-module-scope` | low | `--all` | 같은 쓰기가 모듈 최상단에서 일어남. 요청 단위는 아니고 전역 가변 설정일 뿐. |
| R3 | `axios-interceptor-in-request-path` | high | 켜짐 | 모듈 초기화도 아니고, React effect도 아니고, 같은 함수에 짝이 되는 `.eject()`도 없는 함수 안에서의 `<axios>.interceptors.request\|response.use()`. |
| R4 | `module-state-write-tainted` | high / medium | 켜짐 | 함수 안에서: 모듈 레벨 `let`/`var` 재대입(구조 분해 `[x] = …`, `({ x } = …)` 포함), 모듈 레벨 바인딩의 프로퍼티 대입, 모듈 레벨 `Map`/`Set`/`Array`에 `set/add/push/unshift/splice` 호출(또는 `Object.assign(moduleObj, …)`) — 값 **또는 키**가 요청 스코프일 때. 오염이 요청 프리미티브에서 왔으면 `high`; 유일한 소스가 SSR 진입점이 아닌 함수의 맨 파라미터면 `medium`(메시지: *possible per-request write (value comes from a function argument)*). |
| R5 | `module-state-write-untainted` | low | `--all` | 같은 쓰기인데 값이 요청 스코프가 아님(상수 키 메모 캐시, 카운터). 감사용. |
| R6 | `global-object-write` | medium | 켜짐 | 함수 안에서 `globalThis.x`, `global.x`, `process.env.X` 대입. 브라우저 호스트 객체(`globalThis.location`, `.document`, …)는 제외. |

`high`와 `medium`은 기본으로 표시되고 `low`는 `--all`일 때만 표시됩니다. `--fail-on` 기본값은 `high`이므로
`medium` 발견은 보이기는 하지만 `--fail-on medium`으로 선택하기 전까지 CI를 실패시키지 않습니다.

**요청 프리미티브**(R4 `high`): `headers()`, `cookies()`, `draftMode()`, `getServerSession()` 호출(+
`taintSources.functions`); `req`, `request`, `ctx`, `context`라는 이름의 식별자에 대한 프로퍼티 읽기(+
`taintSources.identifiers`); `params`, `searchParams`, `event`에 대한 프로퍼티 읽기 — **단** 그 식별자가 일반 함수의
파라미터이고 멤버가 요청스럽지 않으면 제외(헬퍼의 `searchParams.get('tab')`은 맨 파라미터 소스일 뿐이고,
`params.cookies`, `event.headers`, SSR 진입점 파라미터에 대한 모든 읽기는 프리미티브로 남습니다 — 요청스러운 멤버는
`headers`, `cookies`, `authorization`, `session`, `user`, `token`, `body`, `query`, `url`, `ip`, `locale`, `req`,
`request`와 그 단수형); 그리고 인식된 SSR 진입점의 파라미터:
`getServerSideProps`, `getStaticProps`, `getInitialProps`(래핑된 경우 포함: `export const getServerSideProps =
withAuth(async (ctx) => …)`), export된 `GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`/`OPTIONS` 라우트 핸들러,
export된 `middleware` / `proxy`(또는 `middleware.*` / `proxy.*` 파일의 default export), export된
`generateMetadata` / `generateViewport`, Server Action(`'use server'` 파일의 export된 함수, 또는 `'use server'`로
시작하는 함수), `{ request | params | context }`를 받는 Remix / React Router `loader` / `action`, `pages/api/**`
파일의 default export, `app/**/page|layout|template|default.*`에서 파라미터를 받는 default export 함수. 전체
표는 "요구 사항 & 호환성"에 있습니다.

### 억제

```ts
// ssr-leak-ignore-next-line
cache.set(key, value);

// ssr-leak-ignore-next-line R5, module-state-write-tainted   ← 나열한 규칙만
counter++;

// ssr-leak-ignore-next-line R4 -- browser only               ← "--" 뒤는 사유이며 무시됩니다
lastScroll = y;
```

```ts
/* ssr-leak-disable */   ← 파일 최상단(첫 문장 앞, 디렉티브 뒤)
```

### 설정 파일

`ssr-leak.config.json`(또는 default export가 있는 `.mjs` / `.js` / `.cjs`):

```json
{
  "ignore": ["**/mocks/**", "src/legacy/browser-only/**"],
  "exclude": ["node_modules", "dist", ".next", "generated"],
  "include": ["public/sw/**"],
  "taintSources": {
    "functions": ["auth", "getToken"],
    "identifiers": ["nextReq"]
  },
  "guards": {
    "server": ["isNodeRuntime"],
    "client": ["inBrowser"]
  }
}
```

- `ignore` — `--root` 기준 glob. 일치하는 파일·디렉터리를 건너뜁니다.
- `exclude` — 어디에 있든 건너뛸 디렉터리 이름. 내장 목록("설치 & 사용" 참고)을 **대체**하므로 계속 원하는
  항목은 다시 적어야 합니다.
- `include` — `--root` 기준 glob. 제외 디렉터리 아래에 있거나, 테스트/스토리/목 파일 이름(`*.test.*`, `*.stories.*`,
  `*.mock.*`, `__tests__/`)이거나, 압축 파일로 보여도 분석합니다.
- `taintSources.functions` — 반환값이 요청 스코프인 함수 이름 추가(내장: `headers`, `cookies`, `draftMode`,
  `getServerSession`).
- `taintSources.identifiers` — 프로퍼티 읽기가 요청 스코프인 식별자 추가(내장: `req`, `request`, `ctx`,
  `context`, `params`, `searchParams`, `event`).
- `guards.server` — 서버에서만 참인 함수·식별자 추가. 브라우저 전용 코드를 알아보는 데 씁니다(내장: `isServer`,
  `isSSR`, `isServerSide`). 호출 대상의 마지막 이름으로 맞추므로 `runtime.isServer()`도 인식합니다.
- `guards.client` — 브라우저 쪽 짝(내장: `isClient`, `isBrowser`, `isClientSide`, `canUseDOM`).
  `typeof window !== 'undefined'` / `typeof document`는 항상 인식하고, `navigator`·`self`는 인식하지 않습니다
  (`navigator`는 Node 21+에, `self`는 Deno·엣지 런타임에 존재).

## 출력 예시

사람용:

```
src/pages/profile.tsx:12:3  R1 axios-defaults-in-function [high]  `axios.defaults.headers.common['Authorization']` is assigned inside a function. The axios instance lives at module scope and is shared by every SSR request, so one request's value is served to the next.
    fix: Create a per-request instance (axios.create({ headers })) or pass headers per call (axios.get(url, { headers })).
src/lib/session.ts:9:3  R4 module-state-write-tainted [high]  Request-scoped data (from `headers()`) is written into module-level state `cfg.token`. The module is shared across SSR requests, so a different user's request can read it.
    fix: Keep request data in request scope: return it, pass it as an argument, or use a per-request container (React cache(), AsyncLocalStorage, or a per-request object).
src/lib/store.ts:4:3  R4 module-state-write-tainted [medium]  Possible per-request write (value comes from a function argument): parameter `next` is written into module-level state `payload`. If this function runs during SSR, the module is shared across requests and a different user's request can read the value.
    fix: Keep request data in request scope: return it, pass it as an argument, or use a per-request container (React cache(), AsyncLocalStorage, or a per-request object).

3 findings (2 high, 1 medium, 0 low) — 412 files scanned in 180ms
```

`--json`:

```json
{
  "version": "0.1.0",
  "root": "/work/acme-web",
  "filesScanned": 412,
  "durationMs": 180,
  "findings": [
    {
      "file": "src/pages/profile.tsx",
      "line": 12,
      "column": 3,
      "endLine": 12,
      "endColumn": 78,
      "ruleId": "R1",
      "rule": "axios-defaults-in-function",
      "confidence": "high",
      "message": "`axios.defaults.headers.common['Authorization']` is assigned inside a function. ...",
      "fixHint": "Create a per-request instance (axios.create({ headers })) or pass headers per call (axios.get(url, { headers })).",
      "snippet": "axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;"
    }
  ],
  "summary": { "total": 3, "high": 2, "medium": 1, "low": 0 },
  "diagnostics": []
}
```

`file`은 `root` 기준 상대 경로(`/` 구분자), `line`/`column`은 1부터 시작합니다. `diagnostics`는 입력 문제
목록입니다(`{ "kind": "missing-path" | "empty-input" | "unreadable-file" | "parse-error", "path"?, "message" }`);
CLI는 이를 stderr에도 출력합니다(`parse-error`는 경고이며 종료 코드를 바꾸지 않습니다). 형식은 메이저 버전 안에서 안정적이며 필드가 추가될 수는 있습니다.

## 종료 코드

| 코드 | 의미 |
| --- | --- |
| 0 | `--fail-on` 이상의 발견 없음 |
| 1 | `--fail-on`(기본 `high`) 이상의 발견이 하나 이상 |
| 2 | 사용법 또는 설정 오류(알 수 없는 옵션, 잘못된 `--fail-on`, 잘못되거나 없는 설정 파일); 존재하지 않는 경로 지정, 빈 입력 집합, 또는 분석한 모든 파일에 문법 오류(`--allow-empty`가 없을 때); 읽을 수 없는 파일 |

종료 코드 2로 끝나는 오류는 스택 트레이스 없이 stderr에 한 줄로 출력됩니다. 문법 오류가 있는 파일은 파싱된
데까지 분석하고 `warning:`으로 출력하며, 그것만으로는 종료 코드가 바뀌지 않습니다. 정확한 메시지는 "실패하는
방식"에 있습니다.

## 프로그래밍 API

```ts
import { analyzeSource, run, shouldFail } from 'ssr-leak';

// 순수 함수, 소스 텍스트 하나. 파일 이름이 파서(ts / tsx / js / jsx)를 결정합니다.
const findings = analyzeSource(code, 'app/page.tsx', { all: false, includeClient: false });

// root 아래 파일을 찾고 ssr-leak.config.*를 적용해 전부 분석합니다.
const report = await run({
  root: process.cwd(),
  patterns: ['src', 'app'],
  all: false,
  includeClient: false,
  config: { ignore: ['**/mocks/**'] }, // 경로(root 기준)도 가능; 생략하면 자동 탐색
  taintSources: { functions: ['auth'] },
});

if (report.diagnostics.length > 0) process.exitCode = 2; // 없는 경로, 빈 입력, 읽을 수 없는 파일
else process.exitCode = shouldFail(report.findings, 'high') ? 1 : 0;
```

`run()`은 입력 문제로 throw하지 않고 `report.diagnostics`에 담아 돌려줍니다. `analyzeFile(file, options)`은
파일 하나를 분석하며, 읽을 수 없으면 `fs.readFileSync`처럼 throw합니다.

이 밖에 `analyzeFile`, `collectFiles`, `collectFilesDetailed`, `formatHuman`, `formatJson`, `summarize`,
`parseIgnoreRules`, `isMinifiedSource`, `RULES`, `RULE_LIST`, `validateConfig`, `loadConfigFile`,
`DEFAULT_EXCLUDED_DIRS`, `DEFAULT_TAINT_FUNCTIONS`, `DEFAULT_TAINT_IDENTIFIERS`, `VERSION`과 타입
`Finding`, `Report`, `Diagnostic`, `RunOptions`, `AnalyzeOptions`, `Config`, `RuleId`, `Confidence`, `Taint`를
export합니다. CLI는 `run()`의 얇은 래퍼입니다.

패키지는 ESM과 CommonJS 빌드를 각각 맞는 선언 파일과 함께 제공합니다(`import`는 `dist/index.d.ts`,
`require`는 `dist/index.d.cts`로 해석). 따라서 `moduleResolution: node16` / `bundler`의 TypeScript 소비자가 두
모듈 시스템 모두에서 동작합니다.

## 동작 원리

전부 구문 분석 + 작은 바인더입니다. 타입 체커, `tsconfig`, 파일 간 해석은 없습니다.

1. **파싱**: `ts.createSourceFile`(확장자로 스크립트 종류 결정; `.js`/`.mjs`/`.cjs`는 JSX를 켠 JS, `.jsx`/`.tsx`는
   JSX). 파서는 오류에 관대합니다: 문법 오류가 있는 파일은 파싱된 데까지 분석하고 첫 오류 위치와 함께
   `parse-error` 진단으로 보고합니다.
2. **파일 게이트**: 첫 문장 앞에 `ssr-leak-disable` 주석이 있거나, 디렉티브 프롤로그에 `'use client'`가 있으면
   (`--include-client`가 아닌 한) 건너뜁니다 — Client Component도 서버에서 렌더링되므로 이 게이트는 소음만
   줄입니다. 테스트·스토리 파일, 제외 디렉터리, 압축 파일은 탐색 단계에서 빠집니다.
3. **모듈 스코프**: 최상위 문장을 순회하며 모든 바인딩을 기록합니다: import(`axios`인지, `axios`의 `create`인지
   포함), `const`/`let`/`var`(초기화식의 형태: `new Map()`, `[]`, `{}`, `<axios>.create()`, `create()`,
   `require()`), 함수, 클래스, enum. 또 최상위 문장이 **직접 호출하는 함수**와 **인스턴스화하는 클래스**의 이름을
   기록합니다.
4. **함수 스코프**: 함수형 노드(선언, 표현식, 화살표, 메서드, 접근자, 생성자)마다 파라미터 이름, 본문에서 선언된
   이름, 각 로컬에 대입된 모든 표현식(초기화식, `=`, 구조 분해, `for…of` 소스)을 가진 스코프를 만듭니다. 블록은
   따로 모델링하지 않아, 함수 본문 어디서든 선언된 이름은 그 함수의 로컬입니다. 이 부정확함은 발견을 **줄이는**
   방향입니다. 스코프에는 그 함수가 인식된 SSR 진입점인지도 기록합니다(바인딩된 이름과 export 형태, default
   export는 파일 경로, 또는 `'use server'` 디렉티브 — "요구 사항 & 호환성" 참고).
5. **이름 해석**: 식별자는 가장 안쪽 함수 스코프부터 바깥으로, 다음 모듈 스코프, 아니면 "미해석"(`globalThis`,
   `process`, `Object`, 선언되지 않은 전역)으로 해석합니다.
6. **요청 경로**: 노드를 감싸는 함수가 하나 이상 있고, 그중 어느 것도 *모듈 초기화*가 아닐 때 "요청 경로에
   있다"고 봅니다. 모듈 초기화 = 모듈 스코프의 IIFE, 최상위 문장이 직접 호출하는 export되지 않은 함수, 또는
   최상위 문장이 인스턴스화하는 export되지 않은 클래스의 생성자(`const boot = new Boot()`).
   `useEffect` / `useLayoutEffect` / `useInsertionEffect` 콜백 안의 코드는 검사하지 않습니다 — effect는 SSR 중
   실행되지 않기 때문입니다.
   **브라우저 전용 가드.** 브라우저에서만 실행될 수 있는 쓰기는 원래 신뢰도 대신 `low`로 보고합니다(`--all`로
   보이며 메시지에 설명이 붙습니다). 인식하는 모양은 모두 같은 함수 안에서: 같은 블록에서 `if (isServer()) return;`
   (또는 `throw`) 뒤의 모든 문장; `if (typeof window !== 'undefined')`의 then 분기;
   `if (typeof window === 'undefined')`의 else 분기; `isClient() && …` / `isServer() || …`의 오른쪽; 삼항 연산자의
   해당 분기. 조건은 "SSR 중 이 값이 무엇인가"에 대한 3값 논리로 봅니다: `isServer() || flag`는 `flag`와 무관하게
   서버에서 참이므로 여전히 서버 가드이고, `isServer() && flag`는 아닙니다. 인식하는 원자: `'undefined'` /
   `'object'`와 비교한 `typeof window|document`(`globalThis.` 경유 포함), `!x`, 마지막 이름이
   내장 또는 설정 `guards` 목록에 있는 호출·식별자. `typeof navigator`·`typeof self`는 가드가 **아닙니다**: Node 21+(와 Bun)는
   `navigator`를 정의하고, Deno와 엣지 런타임은 `self`까지 정의할 수 있어 둘 다 브라우저 전용이라고 볼 수 없으므로 그
   뒤의 쓰기는 SSR 중에도 실행될 수 있습니다. *다른* 함수에 있는 가드(맨
   위에서 호출하는 `ensureBrowser()`)는 따라가지 않습니다.
7. **쓰기**: 모든 대입(`=`, `+=`, …, 구조 분해 대상 포함), `++`/`--`, `Object.assign(target, …)`, 변경 호출
   (`set/add/push/unshift/splice/clear/delete/pop/shift`)에 대해 대상의 루트 식별자와 프로퍼티 체인을 해석해
   분류합니다: axios defaults → R1/R2; `globalThis`/`global`/`process.env` → R6; 모듈 레벨 바인딩 → R4/R5
   (재대입은 `let`/`var`만; 변경 호출은 바인딩이 `Map`/`Set`/`Array` 리터럴·생성자로 초기화된 경우만 — 그래서
   import한 `router`의 `router.push(url)`은 발견이 아닙니다).
8. **오염(taint)**: 흐름 비민감. 표현식이 다음이면 요청 스코프입니다: *어떤* 바깥 함수의 파라미터, 오염 소스
   함수 호출(`headers()`, `cookies()`, `draftMode()`, `getServerSession()` + 설정), 모듈 레벨 바인딩이 아닌 오염
   식별자(`req`, `ctx`, `params`, … + 설정)의 프로퍼티 읽기, 또는 오염된 것으로 만들어진 값: 로컬 변수(그 로컬에
   대입된 어떤 값이든), 멤버 접근, 수신자나 **인자 중 하나라도** 오염된 호출, `await`, `as`, 템플릿 리터럴,
   이항/조건 표현식, 객체/배열 리터럴, `new`. 함수·클래스 표현식은 절대 오염되지 않습니다. 각 오염은
   **출처**를 갖습니다: 요청 프리미티브(오염 소스 호출, 오염 식별자, SSR 진입점의 파라미터)가 맨 파라미터보다
   우선하며 R4의 신뢰도가 이를 따릅니다(`high` vs `medium`).
   **긍정 증거.** 요청 경로에 있는 쓰기가 요청 간 누수가 아님을 증명하는 모양 네 가지가 있으며, 해당하면 발견을
   설명과 함께 `low`로 보고합니다(`--all`로 표시):
   - *중복 억제 Set* — 같은 컬렉션에 `set.has(…)`도 호출하는 함수 안의 `set.add(x)`;
   - *인자 키 캐시* — `k`만 (약하게) 오염되고 `v`는 요청 데이터에서 유래하지 않는 `map.set(k, v)`
     (`stores.set(id, createStore())`, `listeners.set(id, new Set())`);
   - *요청 수명 항목* — 같은 함수가 그 컬렉션에 `.delete(…)`도 호출
     (`inFlight.set(id, p.finally(() => inFlight.delete(id)))`, subscribe/unsubscribe 쌍);
   - *브라우저 참조* — 가장 안쪽 함수에서 쓰기에 이르는 모든 경로에서 `window`, `document`, `location`,
     `localStorage`, `sessionStorage`, `history`, `screen`(`globalThis.` 경유 포함)에 대한 **무조건적** 접근이 먼저
     일어남. 이런 접근은 서버에서 ReferenceError를 던지므로 쓰기가 서버에서 실행될 수 없습니다. `typeof x`, 옵셔널
     체인, `&&` / `||` / `??`의 오른쪽, 삼항 분기, `try` 블록, 중첩 함수는 세지 않으며, `navigator`·`self`는 서버
     런타임이 정의하므로 제외합니다.
9. **억제**는 발견을 기록하기 전에 해당 줄에서 확인하고(`-- 사유` 접미사는 무시), 낮은 신뢰도 발견은 `--all`이
   아니면 버립니다.

### 설계 선택

의도된 결정들입니다. 여러분의 코드베이스에 맞는지 판단할 수 있도록 여기 적어 둡니다.

- **R4 신뢰도는 오염 출처를 따릅니다.** 값이 요청 프리미티브 또는 인식된 SSR 진입점의 파라미터("규칙" 아래 목록)에서
  왔을 때만 `high`입니다. 유일한 오염이 다른 함수의 맨 파라미터인 쓰기 — setter(`set(next) { payload = next }`),
  구독(`listeners.add(listener)`), DI setter, 인자를 키로 쓰는 메모 캐시 — 는 `medium`입니다. 그 함수가 SSR 중
  실행되는지 도구가 알 수 없기 때문입니다. 기본으로 표시되며 `--fail-on medium`으로 실패시킬 수 있습니다. 그에 따라
  R5(오염되지 않은 쓰기)는 `low`, R2는 `low` 유지, R6은 `medium` 유지입니다.
- **`params` / `searchParams` / `event`는 일반 함수 파라미터에서는 약한 이름입니다.** 브라우저 쪽에서 흔한
  이름(`URLSearchParams`, DOM 이벤트, 라우터 params)이라 `save(searchParams) { mirror[key] = searchParams.get('tab') }`
  같은 헬퍼는 `high`가 아니라 `medium`입니다. `req` / `ctx`는 강한 이름으로, 요청스러운 멤버(`params.cookies`)도 강하게,
  SSR 진입점은 영향 없이 유지됩니다.
- **긍정 증거는 낮추기만 하고 지우지 않습니다.** 중복 억제 Set, 인자 키 캐시, 요청 수명 항목, 브라우저 참조 뒤의 쓰기는
  사유를 메시지에 담아 `low`로 남기므로 `--all`은 여전히 완전한 감사 목록입니다. 비용: *다른* 키를 지키는 `.has()`
  검사나 다른 경로의 `.delete()`도 증거로 셉니다.
- **빌드 산출물, 정적 자산, 압축 코드는 기본으로 건너뜁니다**("설치 & 사용"의 디렉터리 목록, `*.min.js`, 2000자
  넘는 줄). 압축 번들은 의미 없는 발견을 수백 개 만들고 정적 자산은 SSR 모듈이 아닙니다. `exclude` / `include`로
  바꿀 수 있습니다.
- **최상위 문장이 한 번 인스턴스화하는 클래스는 생성자 본문에 한해 모듈 초기화**입니다. 최상위 호출 함수 규칙과
  일관됩니다: `class Boot { constructor() { axios.defaults.baseURL = … } } new Boot();`는 R1이 아니라 R2(`--all`)
  입니다. export된 클래스는 여전히 요청 경로 후보입니다.
- **`'use client'` 파일은 안전이 아니라 소음 때문에 건너뜁니다** — "하지 않는 일" 참고. 감사에는 `--include-client`.
- **억제 주석은 사유를 받습니다**: ` -- ` 뒤는 전부 무시됩니다.
- **`axios`에서 구조 분해한 `create`**(`import { create } from 'axios'`, `const { create } = require('axios')`)로 만든
  인스턴스는 axios로 인식되어 `.defaults` 쓰기가 R1/R2입니다.
- **모듈 레벨 바인딩에 대한 구조 분해 대입**(`[last] = …`, `({ last } = …)`)은 쓰기입니다.
- **입력 문제는 종료 코드 2**(없는 경로, 빈 입력 집합, 읽을 수 없는 파일)이며 스택 트레이스 없이 한 줄 메시지를
  냅니다. `--allow-empty`는 앞의 둘을 경고로 바꿉니다. `run()`은 이를 `diagnostics`로 돌려줍니다.
- **R1은 import 바인딩의 `.defaults.headers…`에 대해 발동합니다.** import가 axios라고 증명되지 않아도 그 형태의
  모듈 레벨 HTTP 클라이언트가 바로 이 규칙의 대상이며, 경로가 충분히 특징적입니다.
- **React effect 콜백 안과 모듈 초기화 함수 안에서는 모든 규칙을 건너뜁니다.** 비용: 초기화 IIFE 안에서 등록되는
  핸들러(`app.use(...)`)와, 최상위에서도 호출되고 요청마다도 호출되는 함수는 놓칩니다.
- **`*.stories.*` 파일은 테스트처럼 건너뜁니다**: Storybook 스토리는 Next.js가 서버 렌더링하지 않습니다.
- **`--config`는 `--root` 기준으로 해석합니다**. 위치 인자 glob과 같습니다.
- **직접 지정한 경로가 우선합니다**: 명령줄에 준 파일·디렉터리는 이름이 제외 목록에 있거나 압축 파일로 보여도
  분석합니다.

### 오탐을 줄이는 선택(과 그 비용)

- 최상위에서 호출되는 export되지 않은 함수(또는 거기서 인스턴스화되는 클래스)는 모듈 초기화로 봅니다(R1은 R2가
  되고, R3/R4/R6은 보고하지 않음). 비용: 같은 함수가 다른 곳에서 요청마다 호출되면 놓칩니다.
- 바깥에 모듈 초기화 함수나 effect 콜백이 하나라도 있으면 서브트리 전체가 요청 경로가 아닙니다 — 초기화 IIFE
  안의 `app.use(...)`에 넘긴 콜백도 포함. 비용: 그 핸들러는 놓칩니다.
- axios임이 증명되지 않는 바인딩의 `.defaults.*`는 R1이 아니라 R4(오염 시) 또는 R5입니다 — 단 import 바인딩의
  특징적인 `.defaults.headers…` 경로는 R1입니다.
- 변경 호출 감지는 리터럴 컬렉션 초기화식을 요구합니다. 팩토리가 반환한 `Map`은 놓칩니다.
- `globalThis.location`, `.document`, `.window`, `.navigator`, `.history`, `.localStorage`, `.sessionStorage` 등
  브라우저 호스트 객체는 R6에서 제외합니다.
- 맨 오염 식별자(`req`, `params`, …)는 모듈 레벨 바인딩이 아닐 때만 오염으로 보므로, 모듈 레벨
  `const context = createContext()`는 오염 소스가 아닙니다. 함수 로컬 `const params = …`는 이름만으로 오염으로
  **취급됩니다**. 요청 데이터가 아니면 이름을 바꾸거나 억제하세요.
- 브라우저 전용 가드(`typeof window !== 'undefined'`, `if (isServer()) return;`, …) 뒤의 쓰기는 버리지 않고
  `low`로 낮추므로 `--all`로 감사 목록에 남습니다. 비용: `guards`에 없는 이름의 가드(또는 다른 함수에 있는 가드)는
  보지 못하고, *틀린* 가드(예: 테스트 환경에서 모듈 로드 시 한 번 계산되는 `canUseDOM`)도 그대로 믿습니다.
- `mocks/`, `__mocks__/`, `*.mock.*`는 기본으로 건너뜁니다(MSW·Jest 핸들러는 설계상 모듈 레벨 스토어를 둡니다).
  분석하려면 경로를 직접 지정하거나 `include`에 적으세요. `include`는 모든 기본 건너뛰기보다 우선합니다.

### 알려진 오탐

- **setter와 DI setter**(`set(next) { payload = next }`, `setHeaderProvider(p) { provider = p }`), 저장 값이 인자에서
  유래하는 캐시(`iconCache.set(icon, lazy(load(icon)))`): R4 `medium`으로 보고됩니다. 대부분 브라우저 전용이거나 의도된
  프로세스 전역 상태지만 도구는 누가 호출하는지 볼 수 없습니다. 한 번 검토한 뒤 사유와 함께 억제하거나 넘어가세요 —
  기본 `--fail-on high`에서는 CI를 실패시키지 않습니다. (중복 억제 Set, 값이 요청 데이터가 아닌 캐시,
  subscribe/unsubscribe 쌍은 증거로 인식해 `low`로 보고합니다 — "동작 원리" 참고.)
- **`'use client'`가 없는 컴포넌트의 `useCallback` / 이벤트 핸들러 본문**: 위와 같습니다 — 콜백 안에서 컴포넌트
  prop을 모듈 스코프에 쓰면 그 콜백이 SSR 중 실행되지 않더라도 R4 `medium`입니다.
- **Pages Router의 브라우저 전용 모듈**(`'use client'` 디렉티브가 없음): 스크롤 위치나 popstate 리스너를 모듈
  스코프에 두는 모듈은 브라우저만 호출해도, 그 함수 자체에 가드가 없으면(가드가 호출하는 헬퍼나 호출자에 있으면)
  R4로 잡힙니다. 함수에 가드를 넣거나, `ignore`에 추가하거나, 억제 주석을 쓰세요.
- **기본 디렉터리 밖의 목 서버**(`src/api/fake/` 아래 MSW 핸들러): 엄밀히는 요청 간 스토어입니다. 개발 전용이면
  경로를 `ignore`나 `exclude`에 추가하세요.
- **보수적인 호출 전파**: `cache.set(key, expensive(params.id))`는 `expensive()`가 요청과 무관한 값을 반환해도
  인자를 통해 오염됩니다.
- **요청 프리미티브와 같은 이름의 함수 로컬 변수**(`const params = new URLSearchParams(…)`)는 이름만으로
  오염됩니다.

### 알려진 미탐

- **다른 모듈**을 거치는 값(싱글턴 클래스, setter를 가진 `store` 모듈) — 쓰기 지점이 분석 파일 안에 구문적으로
  보이지 않는 한.
- 요청 데이터를 캡처해 모듈 스코프에 저장된 **클로저**.
- 클래스 메서드에서 `this`로, 또는 별칭으로 변경되는 모듈 레벨 상태(`const c = cache; c.set(...)`는 `c` 자체가
  모듈 레벨일 때만 추적).
- 최상위 `app.use(...)` / 서버 프레임워크 등록에 넘긴 함수 안의 쓰기(초기화로 취급).
- 나중에 대입되는 모듈 레벨 `let`에 든 axios 인스턴스(`let client; function init() { client = axios.create() }`).
- 모듈 최상위에서 호출되면서 **동시에** 다른 모듈에서 요청마다 호출되는 함수(또는 클래스 생성자).
- `--include-client`를 주지 않은 `'use client'` 파일.
- 제외 디렉터리 아래 또는 압축 파일 안의 모든 것(`include`로 다시 포함하지 않는 한).

## 로드맵

- 같은 규칙·같은 ID를 노출하는 ESLint 플러그인(`eslint-plugin-ssr-leak`).
- 타입으로 axios 인스턴스와 컬렉션을 인식하는 선택적 타입 인식 모드(project service).
- export된 setter를 가진 `store` 스타일 모듈의 파일 간 오염 추적.
- 모듈 스코프에 저장된 클로저 / 클래스 인스턴스 규칙.
- `useCallback` 본문과 JSX `on*` prop에 넘긴 함수를 모든 규칙에서 면제(SSR 중 실행되지 않음).
- 브라우저 전용 가드를 함수 경계 너머로 추적(`ensureBrowser()` 헬퍼, 가드된 호출자) — 지금은 가드가 자기 함수만
  덮습니다.
- 탐색 단계의 선택적 `.gitignore` 인식.
- SARIF 출력.

## 개발 & 릴리스

```sh
pnpm install
pnpm build          # tsup: dist/index.{js,cjs,d.ts,d.cts}, dist/cli.js (ESM, shebang)
pnpm test           # 먼저 빌드한 뒤 vitest (CLI e2e 테스트가 dist/cli.js를 실행)
pnpm lint           # biome
pnpm typecheck      # tsc --noEmit
npm pack --dry-run  # 배포 파일 목록 확인
```

릴리스: `package.json`과 `CHANGELOG.md`의 `version`을 올리고 커밋한 뒤

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

`Release` GitHub Action이 빌드·테스트 후 npm **trusted publishing**(GitHub OIDC 신원, 토큰 저장 없음)으로
`npm publish --provenance --access public`을 실행합니다. **배포는 이 태그 → GitHub Actions 흐름으로만 하고,
로컬에서 `npm publish`를 실행하지 마세요.** `publishConfig.registry`가 `https://registry.npmjs.org/`로 고정되어
있어 사설 레지스트리를 가리키는 로컬 `~/.npmrc`가 실수로 한 배포를 다른 곳으로 보내지 못합니다.
`v*` 태그는 저장소 ruleset으로 보호되어 저장소 admin만 만들 수 있으므로, 협업자의 write 권한으로는 릴리스를
트리거할 수 없습니다.

## 라이선스

MIT
