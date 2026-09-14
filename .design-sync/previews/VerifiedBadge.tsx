import { VerifiedBadge } from 'javora-react';

export const Verified = () => <VerifiedBadge state="verified" />;
export const SourceLinked = () => <VerifiedBadge state="source-linked" />;
export const Conflicting = () => <VerifiedBadge state="conflicting" />;
export const Unavailable = () => <VerifiedBadge state="unavailable" />;
export const CompactVerified = () => <VerifiedBadge state="verified" compact />;
export const CompactSecondary = () => <VerifiedBadge state="secondary-corroborated" compact />;
