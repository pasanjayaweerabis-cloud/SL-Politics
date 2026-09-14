import { EmptyState } from 'javora-react';

export const Default = () => <EmptyState />;
export const CustomMessage = () => (
  <EmptyState
    title="No corrections submitted yet"
    message="Reports appear here once they have been reviewed."
    iconName="document"
  />
);
