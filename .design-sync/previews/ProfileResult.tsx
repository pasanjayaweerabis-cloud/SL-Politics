import { ProfileResult } from 'javora-react';
import { currentMinisterView, cabinetMinisterView } from './_mocks';

export const Default = () => <ProfileResult view={currentMinisterView} />;
export const Secondary = () => <ProfileResult view={cabinetMinisterView} />;
