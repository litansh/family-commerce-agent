import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { PurchaseOption } from '@fca/domain';
import { regionOf } from '@fca/domain';
import { Api, type Household, type QuoteResult } from './src/lib/api';
import { loadTokens, signOut, type Tokens } from './src/lib/auth';
import { setRegion, t as tr } from './src/lib/i18n';
import { clearList, useList, type Line } from './src/lib/store';
import { HouseholdSetup } from './src/screens/Household';
import { HomeScreen } from './src/screens/Home';
import { AisleScreen } from './src/screens/Aisle';
import { ListScreen } from './src/screens/List';
import { CheckoutScreen, OptionsScreen } from './src/screens/Options';
import { OrderScreen } from './src/screens/Order';
import { OrdersScreen } from './src/screens/Orders';
import { MeScreen } from './src/screens/Me';
import { SignIn } from './src/screens/SignIn';
import { Intro, introSeen } from './src/screens/Intro';
import { TabBar, type Tab } from './src/TabBar';
import { Loading, S } from './src/ui';

type Screen =
  | { name: 'tabs' }
  | { name: 'aisle'; aisle: string }
  | { name: 'options'; lines: Line[] }
  | { name: 'checkout'; option: PurchaseOption; quote: QuoteResult }
  | { name: 'order'; orderId: string };

export default function App() {
  const [tokens, setTokens] = useState<Tokens | null | undefined>(undefined);
  const [household, setHousehold] = useState<Household | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('home');
  const [intro, setIntro] = useState<boolean | null>(null);
  useEffect(() => { void introSeen().then((seen) => setIntro(!seen)); }, []);
  const [screen, setScreen] = useState<Screen>({ name: 'tabs' });
  const lines = useList();
  const api = useMemo(() => (tokens ? new Api(tokens.idToken) : null), [tokens]);

  useEffect(() => { void loadTokens().then((t) => setTokens(t)); }, []);
  useEffect(() => {
    if (!api) return;
    api.me().then((me) => { const h = me.households[0] ?? null; if (h) setRegion(regionOf(h.country)); setHousehold(h); }).catch(async () => { await signOut(); setTokens(null); });
  }, [api]);

  const invite = async () => {
    if (!api || !household) return;
    const { code } = await api.invite(household.id);
    const msg = tr('inviteMsg', { code });
    Platform.OS === 'web' ? window.alert(msg) : Alert.alert(tr('inviteTitle'), msg);
  };
  const doSignOut = async () => { await signOut(); setTokens(null); setHousehold(undefined); setScreen({ name: 'tabs' }); setTab('home'); };

  let body: React.ReactNode;
  let showTabs = false;
  if (tokens === undefined) body = <Loading />;
  else if (!tokens || !api) body = <SignIn onSignedIn={setTokens} />;
  else if (intro) body = <Intro onDone={() => setIntro(false)} />;
  else if (household === undefined) body = <Loading label={tr('loadingHousehold')} />;
  else if (!household) body = <HouseholdSetup api={api} onDone={(h) => { setRegion(regionOf(h.country)); setHousehold(h); }} />;
  else if (screen.name === 'aisle') body = <AisleScreen api={api} household={household} aisle={screen.aisle} onBack={() => setScreen({ name: 'tabs' })} />;
  else if (screen.name === 'options') body = <OptionsScreen api={api} household={household} lines={screen.lines} onBack={() => setScreen({ name: 'tabs' })} onChoose={(option, quote) => setScreen({ name: 'checkout', option, quote })} onOrder={(orderId) => { clearList(); setScreen({ name: 'order', orderId }); }} />;
  else if (screen.name === 'checkout') body = <CheckoutScreen api={api} household={household} option={screen.option} quote={screen.quote} onBack={() => setScreen({ name: 'options', lines })} onDone={() => { clearList(); setTab('home'); setScreen({ name: 'tabs' }); }} onOrder={(orderId) => { clearList(); setScreen({ name: 'order', orderId }); }} />;
  else if (screen.name === 'order') body = <OrderScreen api={api} household={household} orderId={screen.orderId} onBack={() => { setTab('orders'); setScreen({ name: 'tabs' }); }} />;
  else {
    showTabs = true;
    body = tab === 'home' ? <HomeScreen api={api} household={household} onAisle={(aisle) => setScreen({ name: 'aisle', aisle })} onList={() => setTab('list')} />
      : tab === 'list' ? <ListScreen api={api} household={household} onQuote={(ls) => setScreen({ name: 'options', lines: ls })} onInvite={invite} />
      : tab === 'orders' ? <OrdersScreen api={api} household={household} onOpen={(orderId) => setScreen({ name: 'order', orderId })} />
      : <MeScreen api={api} household={household} onSignOut={doSignOut} onShowIntro={() => setIntro(true)} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={S().screen} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={{ flex: 1 }}>{body}</View>
        {showTabs ? <TabBar active={tab} onChange={setTab} badge={lines.length || undefined} /> : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
