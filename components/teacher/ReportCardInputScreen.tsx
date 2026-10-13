import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

interface ReportCardInputScreenProps {
    student?: { id?: string; fullName?: string } | null;
    term?: string;
    session?: string;
    handleBack?: () => void;
    isAdmin?: boolean;
    subjectContext?: unknown;
}

/**
 * Report card entry — replaced, because the screen did not write to the school's marks.
 *
 * WHAT WAS HERE. A full editor in which a teacher typed a mark per subject, plus skills,
 * psychomotor ratings, attendance totals and comments, and saved the whole card at once.
 * Every call went to an Express server that is not deployed. Nothing it wrote was stored.
 *
 * WHY IT COULD NOT SIMPLY BE POINTED AT THE DATABASE. The database has no such thing as a
 * mark typed onto a report card. `report_cards` is a FROZEN SNAPSHOT: rows are produced by
 * publishing an assessment, and are never edited in place — that is the whole point of the
 * version column, the `supersedes_id` chain and the published timestamp. Editing a snapshot
 * would destroy the record of what the school actually issued to the family.
 *
 * The real path is different in kind: a teacher creates an assessment for their class and
 * subject, enters the marks — one per child per assessment — and publishes it when the
 * marks are complete. That flow already exists and works (Assessments, and the mark
 * register inside it). A teacher could not have used this screen to achieve any of it.
 *
 * AND A DANGEROUS DETAIL WORTH RECORDING. The screen's own comments said a subject teacher
 * must not send back the class teacher's sections "or a stale copy would overwrite what the
 * class teacher saved". That is a lost-update hazard the code was working around by hand —
 * two teachers editing one card, last save wins. Saving per assessment and per child makes
 * that impossible, because no two people write the same row.
 *
 * So: say what is true and send the teacher to the place marks are actually entered.
 */
const ReportCardInputScreen: React.FC<ReportCardInputScreenProps> = ({ handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('reportCardInputScreen.kemasukanMarkah')}
        explanation={
            'Markah tidak lagi ditaip terus ke dalam kad laporan. Markah dimasukkan melalui ' +
            'Penilaian: guru mencipta satu penilaian untuk kelas dan subjek, memasukkan markah ' +
            'setiap murid, kemudian menerbitkannya apabila lengkap. Kad laporan keluarga ' +
            'dihasilkan daripada penilaian yang diterbitkan itu, dan tidak boleh diubah ' +
            'selepas diterbitkan — supaya kad yang telah diberikan kepada ibu bapa kekal ' +
            'seperti yang sekolah keluarkan. Sila gunakan menu Penilaian.'
        }
        handleBack={handleBack}
    />
    );
};

export default ReportCardInputScreen;
