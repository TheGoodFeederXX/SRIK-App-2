import React from 'react';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Lesson notes — replaced, because the school does not keep them here. The screen listed every teacher's lesson notes and let their status be changed. No `lesson_notes` table exists and the calls went to an undeployed server, so the list was always empty. It is not rebuilt here because a lesson note is a teacher's working document with a subject, a class and a date — recording it properly means agreeing what a note must contain and who may read it, which is the school's decision rather than a schema to guess at.
 */
interface AdminLessonNotesScreenProps {
    schoolId?: string;
    currentBranchId?: string;
}

const AdminLessonNotesScreen: React.FC<AdminLessonNotesScreenProps> = ({ schoolId: _schoolId, currentBranchId: _currentBranchId }) => (
    <ComingSoonScreen
        title="Nota Pelajaran"
        explanation={
            'Sekolah belum menyimpan nota pelajaran guru di dalam sistem ini. Buat ' +
            'masa ini nota pelajaran disediakan dan disimpan oleh guru masing-masing ' +
            'untuk kegunaan pengajaran harian. Sila hubungi pejabat atau guru besar ' +
            'untuk sebarang urusan berkaitan nota pelajaran.'
        }
        handleBack={undefined}
    />
);

export default AdminLessonNotesScreen;
