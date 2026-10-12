import React from 'react';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Exam candidate registration — replaced, because there is no exam body to register with.
 * The screen listed external examination bodies, matched children to them and submitted the
 * registrations. There is no exam-body table and no registration table, and the submissions
 * went to an undeployed server. It is not rebuilt here because registering a child for an
 * external examination is done WITH the examining body under its own rules, deadlines and fees.
 * A list of candidates held here that the body never received is the worst possible state: the
 * school would believe a child was entered when they were not.
 */
interface ExamCandidateRegistrationProps {
    schoolId?: string;
    currentBranchId?: string;
    handleBack?: () => void;
    onSelectionChange?: (count: number) => void;
    externalActions?: {
        registering: boolean;
        setRegistering?: (v: boolean) => void;
        triggerRegister?: () => void;
    };
}

/** The parent screen drives registration through this handle. Kept so `ExternalExamsPage`
 *  still type-checks; the methods do nothing, because nothing can be registered. */
export interface ExamCandidateRegistrationHandle {
    register: () => Promise<void>;
    handleExport: () => Promise<void>;
    handleBulkRegister: () => Promise<void>;
}

const ExamCandidateRegistration = React.forwardRef<
    ExamCandidateRegistrationHandle,
    ExamCandidateRegistrationProps
>(({ handleBack, onSelectionChange }, ref) => {
    React.useImperativeHandle(ref, () => ({
        register: async () => {
            // Nothing is submitted. The examining body receives registrations under its own
            // rules and deadlines; this screen cannot stand in for that.
        },
        handleExport: async () => {
            // Nothing to export — no candidate list is stored.
        },
        handleBulkRegister: async () => {
            // Nothing is submitted, for the same reason as `register`.
        },
    }));
    React.useEffect(() => {
        onSelectionChange?.(0);
    }, [onSelectionChange]);

    return (
    <ComingSoonScreen
        title="Pendaftaran Calon Peperiksaan"
        explanation={
            'Sekolah belum mendaftarkan calon peperiksaan luar melalui sistem ini. ' +
            'Buat masa ini pendaftaran calon dibuat terus dengan badan peperiksaan ' +
            'mengikut tarikh dan syarat yang ditetapkan oleh badan tersebut. Sila ' +
            'hubungi pejabat untuk urusan pendaftaran peperiksaan murid.'
        }
        handleBack={handleBack}
    />
    );
});

export { ExamCandidateRegistration };
export default ExamCandidateRegistration;
