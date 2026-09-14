import { EvidencePill } from 'javora-react';
import { evidencePrecise, evidenceInstitutionOnly } from './_mocks';

export const PreciseSource = () => <EvidencePill evidence={evidencePrecise} />;
export const InstitutionOnly = () => <EvidencePill evidence={evidenceInstitutionOnly} />;
export const NoSource = () => <EvidencePill evidence={[]} />;
