import { TenureValue } from 'javora-react';
import { currentMinisterView, formerMemberView } from './_mocks';

export const Ongoing = () => <TenureValue position={currentMinisterView.positions[0]} />;
export const Ended = () => <TenureValue position={formerMemberView.positions[0]} />;
