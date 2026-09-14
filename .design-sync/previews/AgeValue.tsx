import { AgeValue } from 'javora-react';

export const Exact = () => <AgeValue age={{ duration: { kind: 'exact', years: 57 }, atDeath: false }} />;
export const Range = () => <AgeValue age={{ duration: { kind: 'range', min: 57, max: 58 }, atDeath: false }} />;
