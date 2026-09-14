import { AppProvider, useApp } from './state';
import { useHashRoute } from './router';
import { Layout } from './components/Layout';
import { Setup } from './screens/Setup';
import { Dashboard } from './screens/Dashboard';
import { Import } from './screens/Import';
import { Library } from './screens/Library';
import { Locations } from './screens/Locations';
import { BudgetMaster } from './screens/BudgetMaster';
import { TestProgress } from './screens/TestProgress';
import { Snapshots } from './screens/Snapshots';
import { Settings } from './screens/Settings';

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
    case 'snapshots':
      screen = <Snapshots />;
      break;
    case 'settings':
      screen = <Settings />;
      break;
    default:
      screen = <Dashboard />;
  }
  return <Layout screen={route.screen}>{screen}</Layout>;
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
