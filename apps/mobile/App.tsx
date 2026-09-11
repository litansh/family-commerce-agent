import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, PanResponder, Platform, View } from 'react-native';
import { t as theme } from './src/ui';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SessionKeeper } from './src/SessionKeeper';
import { usePending } from './src/lib/pending';
import type { PurchaseOption } from '@fca/domain';
import { regionOf } from '@fca/domain';
import { Api, type Household, type QuoteResult } from './src/lib/api';
import { loadTokens, signOut, type Tokens } from './src/lib/auth';
import { isRTL, loadLanguage, setRegion, t as tr, useLanguage } from './src/lib/i18n';
import { clearList, useList, type Line } from './src/lib/store';
import { carouselBusy } from './src/lib/gesture';
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
  const [firstTime, setFirstTime] = useState(true);
  useEffect(() => { void introSeen().then((seen) => { setIntro(!seen); setFirstTime(!seen); }); }, []);
  const [screen, setScreen] = useState<Screen>({ name: 'tabs' });
  const lines = useList();
  useLanguage();
  // The client asks for a token before every call: `loadTokens` renews it near
  // expiry, so an app left open for hours keeps working; a dead session signs out.
  const api = useMemo(() => (tokens ? new Api(async () => (await loadTokens())?.idToken ?? null, () => { void signOut(); setTokens(null); }) : null), [tokens]);

  // Sliding between the four windows. Only the active one is mounted; on a
  // change it slides in from the side it lives on (mirrored for Hebrew), and
  // a clear horizontal swipe moves to the neighbour. Vertical scrolls pass
  // through untouched because the gesture is only claimed when it is
  // unmistakably sideways.
  const TAB_ORDER: Tab[] = ['home', 'list', 'orders', 'me'];
  const slide = useRef(new Animated.Value(0)).current;
  const frameW = useRef(360);
  const tabRef = useRef<Tab>('home');
  tabRef.current = tab;
  const goTab = (next: Tab) => {
    const from = TAB_ORDER.indexOf(tabRef.current), to = TAB_ORDER.indexOf(next);
    if (to === from) return;
    const sign = (to > from ? 1 : -1) * (isRTL() ? -1 : 1);
    slide.setValue(sign * frameW.current);
    setTab(next);
    Animated.spring(slide, { toValue: 0, useNativeDriver: Platform.OS !== 'web', damping: 26, stiffness: 240, mass: 0.7 }).start();
  };
  const goTabRef = useRef(goTab);
  goTabRef.current = goTab;
  const pan = useRef(PanResponder.create({
    // Deliberate only: a long, clearly sideways, reasonably quick drag that did
    // not begin on a carousel. Nothing else moves the windows.
    onMoveShouldSetPanResponder: (_e, g) => !carouselBusy() && Math.abs(g.dx) > 36 && Math.abs(g.dx) > Math.abs(g.dy) * 2.5,
    onPanResponderRelease: (_e, g) => {
      if (Math.abs(g.dx) < 90 || Math.abs(g.vx) < 0.25 || carouselBusy()) return;
      const i = TAB_ORDER.indexOf(tabRef.current);
      const advance = isRTL() ? g.dx > 0 : g.dx < 0;
      const n = advance ? i + 1 : i - 1;
      if (n >= 0 && n < TAB_ORDER.length) goTabRef.current(TAB_ORDER[n]!);
    },
  })).current;

  useEffect(() => { void loadLanguage().then(() => loadTokens()).then((t) => setTokens(t)); }, []);
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
  else if (intro) body = <Intro firstTime={firstTime} onDone={() => { setIntro(false); setFirstTime(false); }} />;
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

  const pendingCount = usePending().length;
  // On the web the app sits in a phone-width frame; it is a phone app that
  // happens to run in a browser, and stretched to a desktop it looks wrong.
  const frame = Platform.OS === 'web' ? { width: '100%' as const, maxWidth: 430, alignSelf: 'center' as const, flex: 1, backgroundColor: theme.bg } : { flex: 1 };
  return (
    <SafeAreaProvider>
      <SafeAreaView style={[S().screen, Platform.OS === 'web' && { backgroundColor: '#E5EAE7' }]} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={frame} onLayout={(e) => { frameW.current = e.nativeEvent.layout.width || 360; }}>
          {showTabs
            ? <Animated.View {...pan.panHandlers} style={{ flex: 1, transform: [{ translateX: slide }] }}>{body}</Animated.View>
            : <View style={{ flex: 1 }}>{body}</View>}
          {showTabs ? <TabBar active={tab} onChange={goTab} badge={lines.length || undefined} ordersBadge={pendingCount || undefined} /> : null}
          {household && api ? <SessionKeeper api={api} householdId={household.id} /> : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
