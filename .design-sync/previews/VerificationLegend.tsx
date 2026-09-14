import { VerificationLegend } from 'javora-react';
import { verificationStates } from './_mocks';

export const AllStates = () => <VerificationLegend states={verificationStates} />;
export const CommonStates = () => <VerificationLegend states={['verified', 'source-linked', 'unavailable']} />;
