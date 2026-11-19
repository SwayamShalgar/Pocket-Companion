import React, { useEffect, useRef, useState } from 'react';
import {
    AppState,
    Alert,
    Button,
    Text,
    View
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';

export function useLiveLaptop({
    enabled,
    url,
    token,
    onData,
    onUnauthorized
}) {
    const callbacks = useRef({ onData, onUnauthorized });
    callbacks.current = { onData, onUnauthorized };

    const [online, setOnline] = useState(false);
    const [label, setLabel] = useState('Not connected');

    useEffect(() => {
        setOnline(false);

        if (!enabled) {
            setLabel('Not connected');
            return;
        }

        let disposed = false;
        let timer;
        let controller;
        let inFlight = false;

        setLabel('Connecting…');

        async function poll() {
            if (
                disposed ||
                inFlight ||
                AppState.currentState !== 'active'
            ) {
                return;
            }

            clearTimeout(timer);
            inFlight = true;
            controller = new AbortController();

            const timeout = setTimeout(
                () => controller.abort(),
                8000
            );

            try {
                const values = await Promise.all(
                    ['/status', '/catalog'].map(async route => {
                        const response = await fetch(
                            `${url.trim().replace(/\/$/, '')}${route}`,
                            {
                                headers: {
                                    Authorization: `Bearer ${token.trim()}`
                                },
                                signal: controller.signal
                            }
                        );

                        if (!response.ok) {
                            throw Object.assign(
                                new Error('Connection failed'),
                                { status: response.status }
                            );
                        }

                        return response.json();
                    })
                );

                if (!disposed) {
                    callbacks.current.onData(...values);
                    setOnline(true);
                    setLabel('Online · updates every 5 seconds');
                }
            } catch (e) {
                controller.abort();

                if (!disposed) {
                    setOnline(false);
                    setLabel(
                        e.status === 401
                            ? 'Token rejected. Connect again.'
                            : 'Offline · reconnecting automatically'
                    );

                    if (e.status === 401) {
                        callbacks.current.onUnauthorized();
                    }
                }
            } finally {
                clearTimeout(timeout);
                inFlight = false;

                if (
                    !disposed &&
                    AppState.currentState === 'active'
                ) {
                    timer = setTimeout(poll, 5000);
                }
            }
        }

        const listener = AppState.addEventListener(
            'change',
            state => {
                if (state === 'active') {
                    poll();
                } else {
                    clearTimeout(timer);
                    controller?.abort();
                    setOnline(false);
                    setLabel('Paused in background');
                }
            }
        );

        poll();

        return () => {
            disposed = true;
            clearTimeout(timer);
            controller?.abort();
            listener.remove();
        };
    }, [enabled, url, token]);

    return {
        online,
        connectionLabel: label
    };
}

export default function UpgradePanel({
    url,
    token,
    online
}) {
    const [caps, setCaps] = useState(null);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState('');

    const task = useRef(null);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;

        return () => {
            mounted.current = false;
            task.current?.cancelAsync().catch(() => { });
        };
    }, []);

    const base = url.trim().replace(/\/$/, '');

    async function api(route, data) {
        const response = await fetch(base + route, {
            method: data ? 'POST' : 'GET',
            headers: {
                Authorization: `Bearer ${token.trim()}`,
                'Content-Type': 'application/json'
            },
            ...(data ? { body: JSON.stringify(data) } : {}),
            signal: AbortSignal.timeout(20000)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Request failed');
        }

        return result;
    }

    useEffect(() => {
        let active = true;

        if (online) {
            api('/capabilities')
                .then(c => {
                    if (active) setCaps(c);
                })
                .catch(e => {
                    if (active) setProgress(e.message);
                });
        }

        return () => {
            active = false;
        };
    }, [online, url, token]);

    async function control(id) {
        setBusy(true);

        try {
            await api('/control', { id });
        } catch (e) {
            if (mounted.current) {
                Alert.alert('Control failed', e.message);
            }
        } finally {
            if (mounted.current) setBusy(false);
        }
    }

    async function upload(root) {
        setBusy(true);
        setProgress('');

        let uploadFile;
        let timeout;
        let timedOut = false;

        try {
            const picked = await File.pickFileAsync();

            const selectedFile = Array.isArray(picked)
                ? picked[0]
                : picked;

            if (!selectedFile || !mounted.current) return;

            const asset = {
                name: selectedFile.name || 'upload.bin'
            };

            // Make our own temporary copy for the upload.
            uploadFile = new File(
                Paths.cache,
                `companion-upload-${Date.now()}-${Math.random()
                    .toString(36)
                    .slice(2)}`
            );

            selectedFile.copy(uploadFile);

            if (!uploadFile.exists) {
                throw new Error('Could not prepare the selected file.');
            }

            if (uploadFile.size > caps.uploadLimit) {
                throw new Error('Choose a file smaller than 25 MB.');
            }

            const controller = new AbortController();

            // Keeps the existing Cancel upload button working.
            task.current = {
                cancelAsync: async () => {
                    controller.abort();
                }
            };

            timeout = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, 120000);

            setProgress(`Uploading ${asset.name}…`);

            const response = await expoFetch(
                `${base}/upload?root=${encodeURIComponent(root)}` +
                `&name=${encodeURIComponent(asset.name)}`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token.trim()}`,
                        'Content-Type': 'application/octet-stream'
                    },
                    body: uploadFile,
                    signal: controller.signal
                }
            );

            const text = await response.text();
            let result;

            try {
                result = JSON.parse(text);
            } catch {
                throw new Error(
                    `The companion returned an unexpected response (${response.status}).`
                );
            }

            if (!response.ok) {
                throw new Error(result.error || 'Upload failed.');
            }

            if (mounted.current) {
                setProgress(
                    `${result.message}. Refresh the Files tab to see it.`
                );
            }
        } catch (error) {
            Alert.alert(
  'Upload error details',
  String(error.stack || error.message || error)
);
            if (mounted.current) {
                if (error.name === 'AbortError') {
                    setProgress(
                        timedOut
                            ? 'Upload timed out. Check the connection and try again.'
                            : 'Upload cancelled. Check Files if it had already finished.'
                    );
                } else {
                    setProgress(error.message || 'Upload failed.');
                }
            }
        } finally {
            clearTimeout(timeout);
            task.current = null;

            // Delete only the temporary copy created by this function.
            try {
                if (uploadFile?.exists) {
                    uploadFile.delete();
                }
            } catch { }

            if (mounted.current) {
                setBusy(false);
            }
        }
    }

    const controls = {
        volumeDown: 'Volume −',
        volumeUp: 'Volume +',
        mute: 'Mute / unmute',
        playPause: 'Play / pause',
        previousTrack: 'Previous track',
        nextTrack: 'Next track'
    };

    return (
        <View
            style={{
                padding: 16,
                marginTop: 16,
                borderRadius: 16,
                backgroundColor: '#141f32',
                gap: 12
            }}
        >
            <Text
                style={{
                    color: 'white',
                    fontSize: 19,
                    fontWeight: 'bold'
                }}
            >
                Laptop controls & uploads
            </Text>

            {!caps && (
                <Text style={{ color: '#9daec7' }}>
                    Connect to the updated Windows companion
                    to load controls.
                </Text>
            )}

            {caps?.controls.map(id => (
                <Button
                    key={id}
                    title={controls[id]}
                    disabled={!online || busy}
                    onPress={() => control(id)}
                />
            ))}

            <Text style={{ color: '#9daec7' }}>
                Upload up to 25 MB. Existing files are never overwritten.
            </Text>

            {caps?.uploadRoots.map(root => (
                <Button
                    key={root}
                    title={`Upload to ${root}`}
                    disabled={!online || busy}
                    onPress={() => upload(root)}
                />
            ))}

            {!!progress && (
                <Text style={{ color: '#61ddc6' }}>
                    {progress}
                </Text>
            )}

            {busy && task.current && (
                <Button
                    title="Cancel upload"
                    onPress={async () => {
                        await task.current?.cancelAsync();

                        if (mounted.current) {
                            setProgress(
                                'Cancellation requested. Check Files if completion already occurred.'
                            );
                        }
                    }}
                />
            )}
        </View>
    );
}