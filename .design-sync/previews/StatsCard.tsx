import { StatsCard } from 'javora-react';

export const Default = () => <StatsCard value={225} label="Sitting Members of Parliament" iconName="users" />;
export const WithNote = () => (
  <StatsCard value="612" label="Former members recorded" note="Historical crawl is incremental and resumable" iconName="archive" />
);
