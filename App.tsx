import { useEffect, useState } from 'react';
import { BottomNav, MobileHeader, Page, Sidebar, useRoute, navigate } from './components/shell';
import { ToastHost, Skeleton } from './components/ui';
import { useStore } from './store';
import { db } from './core/db/database';
import { bootstrapStorage, isEphemeral, type StorageMode } from './core/db/bootstrap';

import Setup from './pages/Setup';
import Home from './pages/Home';
import Audience from './pages/Audience';
import Discover from './pages/Discover';
import NicheDetail from './pages/NicheDetail';
import ProblemDetail from './pages/ProblemDetail';
import Create from './pages/Create';
import Trends from './pages/Trends';
import Projects from './pages/Projects';
import Learn from './pages/Learn';
import Settings from './pages/Settings';
import { AdsPage, AnalyticsPage, LaunchPage, MarketingPage, PricingPage } from './pages/Strategy';

export default function App() {
  const route = useRoute();
  const { ready, init, settings } = useStore();
  const [dbError, setDbError] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageMode | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const mode = await bootstrapStorage();
        setStorage(mode);
        await db.open();
        await init();
      } catch (e: any) {
        setDbError(e?.message ?? 'Local database unavailable (private browsing mode can block IndexedDB).');
      }
    })();
  }, [init]);

  useEffect(() => {
    if (!ready) return;
    const needsSetup = !settings?.ai;
    if (needsSetup && route.path === '/') navigate('/setup', { replace: true });
  }, [ready, settings?.ai, route.path]);

  if (dbError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card pad max-w-md">
          <h1 className="h2 mb-2">Local storage unavailable</h1>
          <p className="sub">{dbError}</p>
          <p className="sub mt-3">
            CreatorTools stores everything in your browser's IndexedDB. Private/incognito windows and some strict browser settings
            block it. Try a normal window.
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-[260px] space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar route={route} />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileHeader route={route} />
        <div className="flex-1 min-w-0 pb-16 lg:pb-0">
          <Router route={route} />
        </div>
      </div>
      <BottomNav route={route} />
      {storage === 'memory' || isEphemeral() ? (
        <div className="fixed top-0 left-0 right-0 z-[70] bg-sun-600 text-white text-[12.5px] px-4 py-2 text-center">
          Temporary session storage — this environment blocks IndexedDB, so nothing here will be saved.
        </div>
      ) : null}
      <ToastHost />
    </div>
  );
}

function Router({ route }: { route: ReturnType<typeof useRoute> }) {
  const [root] = route.parts;
  switch (root) {
    case undefined:
    case '':
      return <Home />;
    case 'setup':
      return <Setup />;
    case 'home':
      return <Home />;
    case 'audience':
      return <Audience />;
    case 'discover':
      return <Discover />;
    case 'niche':
      return <NicheDetail />;
    case 'problem':
      return <ProblemDetail />;
    case 'create':
      return <Create />;
    case 'trends':
      return <Trends />;
    case 'projects':
      return <Projects />;
    case 'marketing':
      return <MarketingPage />;
    case 'pricing':
      return <PricingPage />;
    case 'ads':
      return <AdsPage />;
    case 'launch':
      return <LaunchPage />;
    case 'analytics':
      return <AnalyticsPage />;
    case 'learn':
      return <Learn />;
    case 'settings':
      return <Settings />;
    default:
      return (
        <Page title="Not found" sub={`No screen matches “${route.path}”.`}>
          <div className="card pad">
            <button className="btn btn-md btn-primary" onClick={() => navigate('/home')}>Back to home</button>
          </div>
        </Page>
      );
  }
}
