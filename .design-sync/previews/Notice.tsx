import { Notice } from 'javora-react';

export const Neutral = () => <Notice title="About this record" body={['Public information is sourced directly from official institutions.']} />;
export const Info = () => <Notice tone="info" iconName="info" title="Demonstration data" body={['This profile uses hand-entered sample data to exercise the interface.']} />;
export const Warning = () => <Notice tone="warning" iconName="alert" title="Sources conflict" body={['Two official sources disagree about this office’s start date.', 'Shown rather than resolved.']} />;
