import { lazy, Suspense } from 'react';
import { AppProvider, useApp } from './state';
import { useHashRoute } from './router';
import { Layout } from './components/Layout';
import { Setup } from './screens/Setup';
import { Dashboard } from './screens/Dashboard';

/*
 * Every screen but the dashboard is loaded when it is first opened.
 *
 * The two heaviest dependencies in the application are the spreadsheet library and
 * the charting library, and between them they were most of a 1.4 MB bundle that had
 * to arrive before anything appeared. Splitting on the route means the first paint
 * carries the dashboard and its curve, and the Two-Week Log's charts or the Import
 * screen's workbook reader arrive when somebody asks for them. The single-file
 * standalone build inlines dynamic imports, so it is unaffected.
 */
const Import = lazy(() => import('./screens/Import').then((m) => ({ default: m.Import })));
const Library = lazy(() => import('./screens/Library').then((m) => ({ default: m.Library })));
const Locations = lazy(() => import('./screens/Locations').then((m) => ({ default: m.Locations })));
const BudgetMaster = lazy(() => import('./screens/BudgetMaster').then((m) => ({ default: m.BudgetMaster })));
const TestProgress = lazy(() => import('./screens/TestProgress').then((m) => ({ default: m.TestProgress })));
const Rollup = lazy(() => import('./screens/Rollup').then((m) => ({ default: m.Rollup })));
const Subsystems = lazy(() => import('./screens/Subsystems').then((m) => ({ default: m.Subsystems })));
const TeamHours = lazy(() => import('./screens/TeamHours').then((m) => ({ default: m.TeamHours })));
const StatusReport = lazy(() => import('./screens/StatusReport').then((m) => ({ default: m.StatusReport })));
const Capacity = lazy(() => import('./screens/Capacity').then((m) => ({ default: m.Capacity })));
const PeriodLog = lazy(() => import('./screens/PeriodLog').then((m) => ({ default: m.PeriodLog })));
const IdRules = lazy(() => import('./screens/IdRules').then((m) => ({ default: m.IdRules })));
const Settings = lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings })));

/** Shown while a screen's code arrives. On a local folder that is a few frames. */
function Loading() {
  return <div className="p-8 text-[13px] text-[var(--text-subtle)]">Loading…</div>;
}

function Shell() {
  const { state } = useApp();
  const route = useHashRoute();
  if (state.status !== 'ready') return <Setup />;
  let screen: React.ReactNode;
  switch (route.screen) {
    case 'import':
      screen = <Import />;
      break;
    case 'library':
      screen = <Library route={route} />;
      break;
    case 'locations':
      screen = <Locations />;
      break;
    case 'budget':
      screen = <BudgetMaster route={route} />;
      break;
    case 'progress':
      screen = <TestProgress route={route} />;
      break;
    case 'rollup':
      screen = <Rollup />;
      break;
    case 'subsystems':
      screen = <Subsystems />;
      break;
    case 'team':
      screen = <TeamHours />;
      break;
    case 'report':
      screen = <StatusReport />;
      break;
    case 'capacity':
      screen = <Capacity />;
      break;
    case 'period':
      screen = <PeriodLog />;
      break;
    case 'idrules':
      screen = <IdRules />;
      break;
    case 'settings':
      screen = <Settings />;
      break;
    default:
      screen = <Dashboard />;
  }
  return (
    <Layout screen={route.screen}>
      <Suspense fallback={<Loading />}>{screen}</Suspense>
    </Layout>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
