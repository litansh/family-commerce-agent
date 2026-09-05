import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { PurchaseOption } from '@fca/domain';
import { Api, type Household, type QuoteResult } from './src/lib/api';
import { loadTokens, signOut, type Tokens } from './src/lib/auth';
import type { Line } from './src/lib/store';
import { HouseholdSetup } from './src/screens/Household';
import { ListScreen } from './src/screens/List';
import { CheckoutScreen, OptionsScreen } from './src/screens/Options';
import { SignIn } from './src/screens/SignIn';
import { Loading, S } from './src/ui';
import { regionOf } from '@fca/domain';
import { setRegion, t as tr } from './src/lib/i18n';

type Screen =
  | { name: 'list' }
  | { name: 'options'; lines: Line[] }
  | { name: 'checkout'; option: PurchaseOption; quote: QuoteResult };

export default function App() {
  const [tokens, setTokens] = useState<Tokens | null | undefined>(undefined);
  const [household, setHousehold] = useState<Household | null | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
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

  let body: React.ReactNode;
  if (tokens === undefined) body = <Loading />;
  else if (!tokens || !api) body = <SignIn onSignedIn={setTokens} />;
  else if (household === undefined) body = <Loading label={tr('loadingHousehold')} />;
  else if (!household) body = <HouseholdSetup api={api} onDone={(h) => { setRegion(regionOf(h.country)); setHousehold(h); }} />;
  else if (screen.name === 'options') body = <OptionsScreen api={api} household={household} lines={screen.lines} onBack={() => setScreen({ name: 'list' })} onChoose={(option, quote) => setScreen({ name: 'checkout', option, quote })} />;
  else if (screen.name === 'checkout') body = <CheckoutScreen api={api} household={household} option={screen.option} quote={screen.quote} onBack={() => setScreen({ name: 'options', lines: [] })} onDone={() => setScreen({ name: 'list' })} />;
  else body = <ListScreen api={api} household={household} onQuote={(lines) => setScreen({ name: 'options', lines })} onInvite={invite} />;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={S().screen} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        {body}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
