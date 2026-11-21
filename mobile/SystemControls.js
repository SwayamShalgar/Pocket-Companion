import React, {
    useEffect,
    useRef,
    useState
} from 'react';

import {
    Alert,
    StyleSheet,
    Text,
    View
} from 'react-native';

import {
    Button,
    Section,
    Sheet,
    palette as C
} from './ui/Experience';

const actions = [
    [
        'lock',
        'Lock Windows',
        'Your desktop will lock. Remote typing cannot unlock it.'
    ],
    [
        'sleep',
        'Sleep',
        'Remote access will stop until the laptop wakes. This app cannot wake it remotely.'
    ],
    [
        'restart',
        'Restart',
        'Save your work first. The connection will drop. The companion must start again after you sign in.'
    ],
    [
        'shutdown',
        'Shut down',
        'Save your work first. You will need to turn the laptop on again before reconnecting.'
    ],
    [
        'wifiOff',
        'Turn Wi-Fi off',
        'Approve the Windows administrator prompt on the laptop. If Wi-Fi carries this connection, remote access will stop. Turn Wi-Fi back on locally, or use Ethernet.'
    ],
    [
        'wifiOn',
        'Turn Wi-Fi on',
        'Requires an existing connection, such as Ethernet, and approval of the administrator prompt on the laptop.'
    ]
];

export default function SystemControls({
    visible,
    onClose,
    connection,
    online,
    onRemote
}) {
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');

    const [brightness, setBrightness] = useState(null);
    const [brightnessNote, setBrightnessNote] = useState('');

    const alive = useRef(true);
    const lock = useRef(false);

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    async function api(route, body) {
        if (!connection) {
            throw new Error('Connect your laptop first.');
        }

        const controller = new AbortController();

        const timer = setTimeout(
            () => controller.abort(),
            20000
        );

        try {
            const response = await fetch(
                connection.url + route,
                {
                    method: body === undefined ? 'GET' : 'POST',
                    headers: {
                        Authorization: `Bearer ${connection.token}`,
                        'Content-Type': 'application/json'
                    },
                    ...(body === undefined
                        ? {}
                        : { body: JSON.stringify(body) }),
                    signal: controller.signal
                }
            );

            const raw = await response.text();
            let result;

            try {
                result = JSON.parse(raw);
            } catch {
                throw new Error(
                    `System endpoint returned HTTP ${response.status}. Register system-controls.cjs and restart the Windows companion.`
                );
            }

            if (!response.ok) {
                throw new Error(
                    result.error || 'Windows request failed.'
                );
            }

            return result;
        } finally {
            clearTimeout(timer);
        }
    }

    useEffect(() => {
        let active = true;
        let timer;

        if (!visible || !online || !connection) return;

        async function poll() {
            try {
                const result = await api('/system');
                if (active) setData(result);
            } catch (e) {
                if (active) setMessage(e.message);
            } finally {
                if (active) timer = setTimeout(poll, 2000);
            }
        }

        poll();

        api('/system/brightness')
            .then(result => {
                if (active) {
                    setBrightness(result.percent);
                    setBrightnessNote('Built-in display');
                }
            })
            .catch(() => {
                if (active) {
                    setBrightness(null);
                    setBrightnessNote(
                        'Direct brightness control is unavailable. Use Display settings below.'
                    );
                }
            });

        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [visible, online, connection]);

    async function run(job) {
        if (lock.current) return;

        lock.current = true;
        setBusy(true);

        try {
            await job();
        } catch (e) {
            if (alive.current) {
                setMessage(
                    e.name === 'AbortError'
                        ? 'Request timed out. It was not retried. Check the laptop before trying again.'
                        : e.message
                );
            }
        } finally {
            lock.current = false;
            if (alive.current) setBusy(false);
        }
    }

    const disabled =
        !online ||
        busy ||
        !data?.supported;

    function schedule(action, label, warning) {
        Alert.alert(
            `${label}?`,
            `${warning}\n\nThe request starts after 10 seconds. You can cancel before it starts.`,
            [
                {
                    text: 'Cancel',
                    style: 'cancel'
                },
                {
                    text: 'Schedule',
                    style: 'destructive',
                    onPress: () =>
                        run(async () => {
                            const result = await api(
                                '/system/action',
                                {
                                    action,
                                    confirmed: true
                                }
                            );

                            setMessage(result.message);
                            setData(await api('/system'));
                        })
                }
            ]
        );
    }

    return (
        <Sheet
            visible={visible}
            title="Power & settings"
            close={() => {
                if (!busy) onClose();
            }}
        >
            <Text style={s.small}>
                Control your laptop’s power and open its Windows settings.
            </Text>

            {!online && (
                <Text style={s.warning}>
                    Laptop offline. Sleep, shutdown, restart, or turning
                    Wi-Fi off can interrupt this connection.
                </Text>
            )}

            {!!message && (
                <Text
                    accessibilityLiveRegion="polite"
                    style={s.message}
                >
                    {message}
                </Text>
            )}

            {!!data?.last && (
                <Text style={s.small}>
                    {data.last.message}
                </Text>
            )}

            {data?.pending && (
                <View style={s.box}>
                    <Text style={s.heading}>
                        {data.pending.label}
                    </Text>

                    <Text style={s.small}>
                        {data.pending.state === 'queued'
                            ? online
                                ? `Starts in approximately ${data.pending.remainingSeconds} seconds.`
                                : 'A request was scheduled. Its current state is unavailable.'
                            : 'Request started. Wi-Fi changes may be waiting for a Windows administrator prompt.'}
                    </Text>

                    <Button
                        title="Cancel scheduled action"
                        soft
                        disabled={
                            disabled ||
                            data.pending.state !== 'queued'
                        }
                        onPress={() =>
                            run(async () => {
                                const result = await api(
                                    '/system/cancel',
                                    { id: data.pending.id }
                                );

                                setMessage(result.message);
                                setData(await api('/system'));
                            })
                        }
                    />
                </View>
            )}

            <Section title="Power" />

            {actions.slice(0, 4).map(
                ([id, label, warning]) => (
                    <Button
                        key={id}
                        title={label}
                        soft
                        disabled={disabled || !!data?.pending}
                        onPress={() =>
                            schedule(id, label, warning)
                        }
                    />
                )
            )}

            <Section title="Wi-Fi adapters" />

            <Text style={s.small}>
                These switches require approval on the laptop.
                Turning Wi-Fi off may disconnect this app.
                There is no automatic reconnection until a network
                is available again.
            </Text>

            {actions.slice(4).map(
                ([id, label, warning]) => (
                    <Button
                        key={id}
                        title={label}
                        soft
                        disabled={disabled || !!data?.pending}
                        onPress={() =>
                            schedule(id, label, warning)
                        }
                    />
                )
            )}

            <Section title="Bluetooth" />

            <Text style={s.small}>
                Controls the laptop’s Bluetooth radio. Turning it off
                disconnects Bluetooth accessories and may interrupt
                Bluetooth tethering.
            </Text>

            <Button
                title="Turn Bluetooth on"
                soft
                disabled={disabled || !!data?.pending}
                onPress={() =>
                    schedule(
                        'bluetoothOn',
                        'Turn Bluetooth on',
                        'Windows may require permission to change its Bluetooth radio state.'
                    )
                }
            />

            <Button
                title="Turn Bluetooth off"
                soft
                disabled={disabled || !!data?.pending}
                onPress={() =>
                    schedule(
                        'bluetoothOff',
                        'Turn Bluetooth off',
                        'Bluetooth keyboards, mice, headphones, and Bluetooth network connections may disconnect.'
                    )
                }
            />

            <Button
                title="Open Bluetooth settings"
                soft
                disabled={disabled}
                onPress={() =>
                    run(async () => {
                        const result = await api(
                            '/system/settings',
                            { id: 'bluetooth' }
                        );

                        setMessage(result.message);
                    })
                }
            />

            <Section title="Brightness" />

            <Text style={s.small}>
                {brightness === null
                    ? brightnessNote || 'Checking display support…'
                    : `${brightness}% · ${brightnessNote}`}
            </Text>

            <View style={s.row}>
                {[20, 40, 60, 80, 100].map(value => (
                    <View
                        key={value}
                        style={{ minWidth: 58 }}
                    >
                        <Button
                            title={`${value}%`}
                            soft={value !== brightness}
                            disabled={
                                disabled ||
                                brightness === null
                            }
                            onPress={() =>
                                run(async () => {
                                    await api(
                                        '/system/brightness',
                                        { percent: value }
                                    );

                                    const actual = await api(
                                        '/system/brightness'
                                    );

                                    setBrightness(actual.percent);
                                    setMessage(
                                        'Display brightness refreshed.'
                                    );
                                })
                            }
                        />
                    </View>
                ))}
            </View>

            <Section title="Windows settings" />

            <Text style={s.small}>
                These buttons open pages on your laptop, not on your
                phone. Use the laptop screen and remote controls to
                adjust them. Some settings require administrator approval.
            </Text>

            {(data?.settings || []).map(item => (
                <Button
                    key={item.id}
                    title={item.label}
                    icon="open-outline"
                    soft
                    disabled={disabled}
                    onPress={() =>
                        run(async () => {
                            const result = await api(
                                '/system/settings',
                                { id: item.id }
                            );

                            setMessage(result.message);
                        })
                    }
                />
            ))}

            <Button
                title="Open remote controls"
                icon="game-controller-outline"
                disabled={!online || busy}
                onPress={onRemote}
            />

            {busy && (
                <Text style={s.small}>Please wait…</Text>
            )}
        </Sheet>
    );
}

const s = StyleSheet.create({
    small: {
        color: C.muted,
        fontSize: 13,
        lineHeight: 20
    },
    heading: {
        color: C.text,
        fontSize: 17,
        fontWeight: '700'
    },
    message: {
        color: C.lime,
        fontSize: 14,
        lineHeight: 21
    },
    warning: {
        color: C.red,
        fontSize: 14,
        lineHeight: 21
    },
    box: {
        padding: 16,
        borderRadius: 18,
        backgroundColor: C.raised,
        gap: 12
    },
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8
    }
});