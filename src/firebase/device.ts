import { BaseDevice } from '@andrei-tatar/nora-firebase-common';
import firebase from 'firebase/app';
import { Observable } from 'rxjs';
import { filter, publishReplay, refCount } from 'rxjs/operators';
import { FirebaseSync } from './sync';

export class FirebaseDevice<T extends BaseDevice = BaseDevice> {
    private onDisconnectRule?: firebase.database.OnDisconnect;

    state$ = new Observable<T['state']>(observer => {
        const handler = (snapshot: firebase.database.DataSnapshot) => {
            observer.next(snapshot.val());
        };
        this.state.on('value', handler);
        return () => this.state.off('value', handler);
    }).pipe(
        filter(v => !!v && typeof v === 'object'),
        publishReplay(1),
        refCount(),
    );

    protected get state() {
        return this.sync.states.child(this.device.id);
    }

    protected get noraSpecific() {
        return this.sync.noraSpecific.child(this.device.id);
    }

    constructor(
        private sync: FirebaseSync,
        public readonly device: Readonly<T>,
    ) {
    }

    async init() {
        this.onDisconnectRule?.cancel();
        this.onDisconnectRule = this.state.child('online').onDisconnect();
        await Promise.all([
            this.onDisconnectRule.set(false),
        ]);
    }

    cancelDisconnectRule() {
        setTimeout(() => this.onDisconnectRule?.cancel(), 1000);
    }

    async updateState(update: Partial<T['state']>) {
        await this.sync.updateState(this.device.id, update);
    }

    async updateStateSafer<TPayload, TState = Partial<T['state']>>(
        update: TPayload,
        mapping?: { from: keyof TPayload, to: keyof TState }[]) {
        if (typeof update !== 'object') {
            return false;
        }

        const currentState = await this.state.once('value').then(r => r.val());
        this.updateProperties(update, currentState, currentState, mapping);
        await this.updateState(currentState);
        return true;
    }

    private updateProperties(from: any, to: any, rootState: any,
        mapping?: { from: keyof any, to: keyof any }[],
        path = 'msg.payload.') {

        for (const [key, v] of Object.entries(from)) {
            let value: any = v;

            const mapTo = mapping?.find(m => m.from === key)?.to ?? key;

            const prevValue = to[mapTo];
            if (typeof prevValue !== typeof value) {
                if (typeof prevValue === 'number') {
                    value = +value;
                }

                if (typeof prevValue === 'boolean') {
                    value = !!value;
                }
            }

            if (typeof value === 'object' && typeof prevValue === 'object') {
                this.updateProperties(v, { ...prevValue }, rootState, mapping, `${path}${key}.`);
            } else {
                to[mapTo] = value;

                // if (!validate('state', rootState)) {
                //     throw new Error(`Invalid property ${path}${key} with value ${value}`);
                // }
            }
        }
    }
}
