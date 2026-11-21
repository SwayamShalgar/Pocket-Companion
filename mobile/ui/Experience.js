import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react';

import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import {
  SafeAreaView
} from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';

export const palette = {
  bg: '#0b1020',
  card: '#131d31',
  raised: '#1e2a43',
  line: '#2b3b58',
  text: '#f4f7ff',
  muted: '#a9b8d2',
  lime: '#87e6cd',
  ink: '#092e2a',
  red: '#ffadad'
};

const C = palette;
const Motion = createContext(true);

export function useReducedMotion() {
  return useContext(Motion);
}

export function MotionProvider({ children }) {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    let active = true;
    let changed = false;

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      value => {
        changed = true;
        setReduced(value);
      }
    );

    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (active && !changed) setReduced(value);
      })
      .catch(() => {});

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return (
    <Motion.Provider value={reduced}>
      {children}
    </Motion.Provider>
  );
}

export function Icon({
  name,
  size = 22,
  color = C.text
}) {
  return <Ionicons name={name} size={size} color={color} />;
}

function Tap({
  children,
  style,
  disabled,
  onPress,
  label,
  role = 'button',
  selected
}) {
  const reduced = useContext(Motion);
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    scale.stopAnimation();
    scale.setValue(1);
    return () => scale.stopAnimation();
  }, [reduced, disabled]);

  function animate(value) {
    if (reduced) return;

    Animated.spring(scale, {
      toValue: value,
      speed: 35,
      bounciness: 3,
      useNativeDriver: true
    }).start();
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole={role}
        accessibilityLabel={label}
        accessibilityState={{
          disabled: !!disabled,
          ...(selected === undefined ? {} : { selected })
        }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => animate(0.97)}
        onPressOut={() => animate(1)}
        style={({ pressed }) => [
          style,
          {
            opacity: disabled ? 0.45 : pressed ? 0.85 : 1
          }
        ]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export function Button({
  title,
  icon,
  onPress,
  disabled,
  soft = false
}) {
  return (
    <Tap
      label={title}
      onPress={onPress}
      disabled={disabled}
      style={[s.button, soft && s.soft]}
    >
      {icon && (
        <Icon
          name={icon}
          size={19}
          color={soft ? C.text : C.ink}
        />
      )}
      <Text
        style={[
          s.buttonText,
          soft && { color: C.text }
        ]}
      >
        {title}
      </Text>
    </Tap>
  );
}

export function Round({
  icon,
  label,
  onPress,
  disabled,
  active
}) {
  return (
    <Tap
      label={label}
      onPress={onPress}
      disabled={disabled}
      style={[
        s.round,
        active && {
          backgroundColor: C.lime,
          borderColor: C.lime
        }
      ]}
    >
      <Icon
        name={icon}
        color={active ? C.ink : C.text}
      />
    </Tap>
  );
}

export function Input({
  style,
  secureTextEntry,
  placeholder,
  value,
  onChangeText,
  editable = true,
  ...props
}) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);

  return (
    <View
      style={[
        s.field,
        focused && { borderColor: C.lime },
        !editable && { opacity: 0.55 }
      ]}
    >
      <TextInput
        {...props}
        accessibilityLabel={
          props.accessibilityLabel || placeholder
        }
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        secureTextEntry={!!secureTextEntry && hidden}
        placeholderTextColor={C.muted}
        selectionColor={C.lime}
        onFocus={event => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={event => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        style={[s.input, style]}
      />

      {secureTextEntry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            hidden ? 'Show token' : 'Hide token'
          }
          disabled={!editable}
          onPress={() => setHidden(!hidden)}
          style={s.inputAction}
        >
          <Icon
            name={hidden ? 'eye-outline' : 'eye-off-outline'}
            size={20}
            color={C.muted}
          />
        </Pressable>
      ) : (
        !!value &&
        !!onChangeText && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear field"
            disabled={!editable}
            onPress={() => onChangeText('')}
            style={s.inputAction}
          >
            <Icon
              name="close-circle-outline"
              size={20}
              color={C.muted}
            />
          </Pressable>
        )
      )}
    </View>
  );
}

export function Section({ title, extra, onPress }) {
  return (
    <View style={s.section}>
      <Text style={s.heading}>{title}</Text>

      {extra && (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          hitSlop={8}
          style={s.sectionAction}
        >
          <Text style={s.link}>{extra}</Text>
          <Icon
            name="chevron-forward"
            size={14}
            color={C.lime}
          />
        </Pressable>
      )}
    </View>
  );
}

export function ScreenTransition({ children, scene }) {
  const reduced = useContext(Motion);
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    progress.stopAnimation();

    if (reduced) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    });

    animation.start();
    return () => animation.stop();
  }, [scene, reduced]);

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0.75, 1]
        }),
        transform: [{
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [8, 0]
          })
        }]
      }}
    >
      {children}
    </Animated.View>
  );
}

export function Empty({ icon, title, text }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Icon name={icon} size={32} color={C.lime} />
      </View>
      <Text style={s.heading}>{title}</Text>
      <Text
        style={[
          s.small,
          { textAlign: 'center', maxWidth: 280 }
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

export function Bar({ value }) {
  const reduced = useContext(Motion);
  const number = Math.max(
    0,
    Math.min(100, Number(value) || 0)
  );

  const progress = useRef(
    new Animated.Value(number)
  ).current;

  useEffect(() => {
    progress.stopAnimation();

    if (reduced) {
      progress.setValue(number);
      return;
    }

    const animation = Animated.timing(progress, {
      toValue: number,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    });

    animation.start();
    return () => animation.stop();
  }, [number, reduced]);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(number)
      }}
      style={s.track}
    >
      <Animated.View
        style={[
          s.fill,
          {
            width: progress.interpolate({
              inputRange: [0, 100],
              outputRange: ['0%', '100%']
            })
          }
        ]}
      />
    </View>
  );
}

export function Sheet({
  visible,
  title,
  close,
  children
}) {
  const reduced = useContext(Motion);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? 'none' : 'slide'}
      onRequestClose={close}
    >
      <View style={s.scrim}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close panel"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />

        <KeyboardAvoidingView
          behavior={
            Platform.OS === 'ios' ? 'padding' : 'height'
          }
          style={s.sheet}
        >
          <SafeAreaView
            edges={['bottom']}
            style={{ flexShrink: 1 }}
            accessibilityViewIsModal
          >
            <View style={s.handle} />

            <View style={s.sheetTop}>
              <Text style={[s.heading, { flex: 1 }]}>
                {title}
              </Text>
              <Round
                icon="close"
                label="Close panel"
                onPress={close}
              />
            </View>

            <ScrollView
              style={{ flexShrink: 1 }}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                padding: 22,
                gap: 16
              }}
            >
              {children}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export function ConnectionHeader({
  online,
  connected,
  computer,
  updated,
  onPress,
  disabled
}) {
  return (
    <View style={s.header}>
      <View style={s.logo}>
        <Icon
          name="laptop-outline"
          color={C.lime}
          size={24}
        />
      </View>

      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.brand}>Pocket Companion</Text>

        <View style={s.connectionLine}>
          <View
            style={[
              s.dot,
              {
                backgroundColor: online
                  ? C.lime
                  : C.red
              }
            ]}
          />

          <Text
            numberOfLines={1}
            style={[s.small, { flexShrink: 1 }]}
          >
            {online
              ? computer
              : connected
                ? 'Offline · trying to reconnect'
                : 'Connect your laptop to get started'}
          </Text>
        </View>

        {!online && !!updated && (
          <Text style={s.caption}>
            Last updated {updated}
          </Text>
        )}
      </View>

      <Round
        icon="options-outline"
        label="Connection settings"
        onPress={onPress}
        disabled={disabled}
      />
    </View>
  );
}

export function HeroCard({
  battery,
  online,
  computer,
  updated
}) {
  return (
    <View style={s.hero}>
      <View style={s.heroTop}>
        <Text style={s.heroEyebrow}>
          YOUR LAPTOP
        </Text>

        <View style={s.pill}>
          <Icon
            name={
              online ? 'checkmark-circle' : 'time-outline'
            }
            size={13}
            color={C.ink}
          />
          <Text style={s.pillText}>
            {online ? 'Connected' : 'Offline'}
          </Text>
        </View>
      </View>

      <Text numberOfLines={1} style={s.computer}>
        {computer || 'Ready when you are'}
      </Text>

      <View style={s.batteryRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.percent}>
            {battery?.present
              ? `${battery.percent}%`
              : '—'}
          </Text>

          <Text style={s.heroCopy}>
            {battery?.present
              ? battery.charging
                ? 'Plugged in · Charging'
                : 'Battery remaining'
              : 'Connect to check battery status'}
          </Text>
        </View>

        <View style={s.batteryIcon}>
          <Icon
            name={
              battery?.charging
                ? 'flash-outline'
                : 'battery-half-outline'
            }
            size={38}
            color={C.ink}
          />
        </View>
      </View>

      <View style={s.heroTrack}>
        <View
          style={{
            height: '100%',
            width: `${
              battery?.present
                ? Math.max(0, Math.min(100, battery.percent))
                : 0
            }%`,
            backgroundColor: C.ink,
            borderRadius: 4
          }}
        />
      </View>

      <Text style={s.heroFoot}>
        {updated
          ? `${online ? 'Updated' : 'Last seen'} ${updated} · ${
            online
              ? 'Live status every 5 seconds'
              : 'Showing last known status'
          }`
          : 'Your files and controls, wherever you are.'}
      </Text>
    </View>
  );
}

export function QuickActions({
  disabled,
  onRemote,
  onFiles,
  onApps
}) {
  return (
    <View style={{ gap: 12 }}>
      <Tap
        disabled={disabled}
        onPress={onRemote}
        label="Open remote controls"
        style={s.remote}
      >
        <View style={s.actionIcon}>
          <Icon
            name="game-controller-outline"
            color={C.lime}
            size={25}
          />
        </View>

        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.actionTitle}>Take control</Text>
          <Text style={s.small}>
            Touchpad, keyboard & clipboard
          </Text>
        </View>

        <Icon
          name="arrow-forward"
          color={C.lime}
          size={20}
        />
      </Tap>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        {[
          ['folder-open-outline', 'Browse files', onFiles],
          ['apps-outline', 'Open an app', onApps]
        ].map(([icon, label, press]) => (
          <View key={label} style={{ flex: 1 }}>
            <Tap
              onPress={press}
              label={label}
              style={s.quick}
            >
              <Icon
                name={icon}
                color={
                  label === 'Browse files'
                    ? '#b6a7ff'
                    : C.lime
                }
              />
              <Text style={s.actionTitle}>
                {label}
              </Text>
              <Icon
                name="arrow-forward-outline"
                color={C.muted}
                size={16}
              />
            </Tap>
          </View>
        ))}
      </View>
    </View>
  );
}

export function TabBar({ tabs, active, onChange }) {
  const reduced = useContext(Motion);
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  const cell = width / tabs.length;
  const index = Math.max(
    0,
    tabs.findIndex(([name]) => name === active)
  );

  useEffect(() => {
    x.stopAnimation();

    if (reduced || !width) {
      x.setValue(index * cell);
      return;
    }

    const animation = Animated.spring(x, {
      toValue: index * cell,
      speed: 25,
      bounciness: 0,
      useNativeDriver: true
    });

    animation.start();
    return () => animation.stop();
  }, [index, width, reduced]);

  return (
    <View
      style={s.nav}
      onLayout={event =>
        setWidth(event.nativeEvent.layout.width)
      }
    >
      {!!width && (
        <Animated.View
          pointerEvents="none"
          style={[
            s.tabIndicator,
            {
              width: Math.max(0, cell - 12),
              transform: [{ translateX: x }]
            }
          ]}
        />
      )}

      {tabs.map(([name, icon]) => (
        <Pressable
          key={name}
          accessibilityRole="tab"
          accessibilityState={{
            selected: active === name
          }}
          onPress={() => onChange(name)}
          style={s.tab}
        >
          <Icon
            name={icon}
            size={22}
            color={
              active === name ? C.lime : C.muted
            }
          />
          <Text
            style={[
              s.tabLabel,
              active === name && { color: C.lime }
            ]}
          >
            {name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: 17,
    paddingHorizontal: 18,
    paddingVertical: 15,
    backgroundColor: C.lime,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10
  },
  buttonText: {
    color: C.ink,
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1
  },
  soft: {
    backgroundColor: C.raised,
    borderWidth: 1,
    borderColor: C.line
  },
  round: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: C.raised,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center'
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.raised,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 16
  },
  input: {
    flex: 1,
    padding: 15,
    fontSize: 15,
    color: C.text,
    minHeight: 52
  },
  inputAction: {
    width: 46,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center'
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 14
  },
  sectionAction: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  heading: {
    color: C.text,
    fontSize: 20,
    fontWeight: '700',
    flexShrink: 1
  },
  link: {
    color: C.lime,
    fontSize: 13,
    fontWeight: '600'
  },
  small: {
    color: C.muted,
    fontSize: 13,
    lineHeight: 20
  },
  caption: {
    color: C.muted,
    fontSize: 11
  },
  empty: {
    padding: 32,
    minHeight: 230,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16
  },
  emptyIcon: {
    width: 76,
    height: 76,
    backgroundColor: C.raised,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.line
  },
  track: {
    height: 6,
    backgroundColor: C.line,
    borderRadius: 4,
    overflow: 'hidden'
  },
  fill: {
    height: '100%',
    backgroundColor: C.lime,
    borderRadius: 4
  },
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#00000099'
  },
  sheet: {
    maxHeight: '90%',
    backgroundColor: C.card,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.line
  },
  handle: {
    width: 42,
    height: 4,
    backgroundColor: C.line,
    borderRadius: 4,
    alignSelf: 'center',
    marginTop: 12
  },
  sheetTop: {
    paddingHorizontal: 22,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  logo: {
    width: 44,
    height: 44,
    backgroundColor: C.card,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center'
  },
  brand: {
    color: C.text,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3
  },
  connectionLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3
  },
  hero: {
    padding: 23,
    borderRadius: 28,
    backgroundColor: C.lime,
    gap: 12
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  heroEyebrow: {
    color: C.ink,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '700'
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ffffff55',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20
  },
  pillText: {
    color: C.ink,
    fontSize: 11,
    fontWeight: '600'
  },
  computer: {
    color: C.ink,
    fontSize: 20,
    fontWeight: '600'
  },
  batteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14
  },
  percent: {
    color: C.ink,
    fontSize: 62,
    lineHeight: 73,
    letterSpacing: -3,
    fontWeight: '700'
  },
  heroCopy: {
    color: C.ink,
    fontSize: 12,
    lineHeight: 18
  },
  batteryIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#ffffff44',
    alignItems: 'center',
    justifyContent: 'center'
  },
  heroTrack: {
    height: 5,
    backgroundColor: '#092e2a22',
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 4
  },
  heroFoot: {
    color: C.ink,
    fontSize: 10,
    lineHeight: 16
  },
  remote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: '#39635f',
    padding: 17,
    borderRadius: 22,
    gap: 13
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#173d3c',
    alignItems: 'center',
    justifyContent: 'center'
  },
  actionTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: '600'
  },
  quick: {
    minHeight: 125,
    padding: 17,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    gap: 12
  },
  nav: {
    flexDirection: 'row',
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingVertical: 8
  },
  tabIndicator: {
    position: 'absolute',
    top: 8,
    left: 6,
    bottom: 8,
    backgroundColor: '#213f42',
    borderRadius: 18
  },
  tab: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 2
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: C.muted
  }
});