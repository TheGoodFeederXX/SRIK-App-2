import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { BookOpenIcon, SaveIcon, ChevronRightIcon } from '../../constants';
import { getSchoolProfile, updateSchoolSettings } from '../../src/lib/supabase/schoolProfile';
import { useAutoSync } from '../../hooks/useAutoSync';
import { useAuth } from '../../context/AuthContext';
import CenteredLoader from '../ui/CenteredLoader';

const Accordion: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <motion.button whileTap={{ scale: 0.99 }} onClick={() => setIsOpen(!isOpen)} className="w-full flex justify-between items-center p-4 text-left font-bold text-gray-800">
        <span>{title}</span>
        <motion.span animate={{ rotate: isOpen ? 90 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
          <ChevronRightIcon />
        </motion.span>
      </motion.button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="p-4 border-t">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const AcademicSettingsScreen: React.FC = () => {
    const { t } = useTranslation();
  const auth = useAuth() as any;
  const { currentSchool, user } = auth;
  const schoolId = currentSchool?.id || user?.user_metadata?.school_id;
  const branchId = auth.currentBranchId;

  const [calendar, setCalendar] = useState({ start: '2024-09-05', end: '2025-06-20' });
  const [grading, setGrading] = useState({ scale: 'percentage', weighted: true });
  // The curriculum. KSSR IS THE SCHOOL'S CURRICULUM AND THE ONLY ONE IT HAS.
  //
  // This was a three-way choice — 'KSSR' | 'British' | 'Both' — and the default was
  // once 'Nigerian'. The school is not accredited for the British curriculum, has no
  // dual stream, and follows the Malaysian primary syllabus, so the two extra options
  // were a way to save a setting that made the rest of the app offer subject lists and
  // term structures the school does not use. SRIK follows KSSR; that is now the
  // setting, not an option in a list.
  const KSSR = 'KSSR' as const;
  const [curriculumType, setCurriculumType] = useState<string>(KSSR);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Unified Backend-driven Auto Sync
  useAutoSync(['system_settings'], () => {
    console.log('🔄 [AcademicSettingsScreen] Auto-sync triggered');
    fetchSettings();
  });

  const fetchSettings = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      // These three live in the school's own settings. `api.getSystemSettings`
      // asked an Express endpoint that is not deployed, so every field on this
      // screen came back blank and saving wrote blanks back over the real values.
      const profile = await getSchoolProfile();
      const stored = (profile.settings || {}) as Record<string, any>;

      if (stored.academic_calendar) setCalendar(stored.academic_calendar);
      if (stored.grading_config) setGrading(stored.grading_config);
      // A setting saved before this change may still say 'British' or 'Both'. Those
      // are no longer choices, so reading one back would leave the select showing a
      // blank — and the next save would write that blankness over the real value.
      // Anything other than this school's own curriculum is therefore read as KSSR,
      // and the next save corrects what is stored.
      if (stored.curriculum_type === KSSR) setCurriculumType(KSSR);
    } catch (err) {
      console.error('Failed to load settings:', err);
      toast.error(t('academicSettingsScreen.errorLoadingAcademicSettings'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [schoolId]);

  const saveSettings = async () => {
    if (!schoolId) {
      toast.error(t('academicSettingsScreen.schoolContextMissing'));
      return;
    }
    setSaving(true);
    try {
      // One merge, so this screen cannot revert a setting changed elsewhere while
      // it was open. There is no school or branch id: one school, one settings row.
      await updateSchoolSettings({
        academic_calendar: calendar,
        grading_config: grading,
        curriculum_type: curriculumType,
      });

      toast.success(t('academicSettingsScreen.settingsSavedSuccessfully'));
    } catch (err: any) {
      console.error('Error saving settings:', err);
      toast.error(`${t('academicSettingsScreen.failedToSaveSettings')}: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-4 bg-gray-50 h-full flex flex-col">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-xl font-bold text-gray-800">{t('academicSettingsScreen.academicConfiguration')}</h2>
        <motion.button
          whileHover={!(saving || loading) ? { scale: 1.02 } : {}}
          whileTap={!(saving || loading) ? { scale: 0.98 } : {}}
          onClick={saveSettings}
          disabled={saving || loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? t('academicSettingsScreen.saving') : t('academicSettingsScreen.saveChanges')}
        </motion.button>
      </div>

      {loading ? <CenteredLoader message={t('academicSettingsScreen.loadingSettings')} className="py-8" /> : (
        <>
          <Accordion title={t('academicSettingsScreen.schoolCalendar')} defaultOpen>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700">{t('academicSettingsScreen.academicYearStart')}</label>
                <input type="date" value={calendar.start} onChange={e => setCalendar(c => ({ ...c, start: e.target.value }))} className="w-full mt-1 p-2 border border-gray-300 rounded-md bg-gray-50" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">{t('academicSettingsScreen.academicYearEnd')}</label>
                <input type="date" value={calendar.end} onChange={e => setCalendar(c => ({ ...c, end: e.target.value }))} className="w-full mt-1 p-2 border border-gray-300 rounded-md bg-gray-50" />
              </div>
            </div>
          </Accordion>
          <Accordion title={t('academicSettingsScreen.gradingScales')}>
            <div className="space-y-3">
              <label className="text-sm font-medium text-gray-700">{t('academicSettingsScreen.defaultGradingScale')}</label>
              <select value={grading.scale} onChange={e => setGrading(g => ({ ...g, scale: e.target.value }))} className="w-full p-2 border border-gray-300 rounded-md bg-gray-50">
                <option value="percentage">{t('academicSettingsScreen.percentage0100')}</option>
                <option value="letter">{t('academicSettingsScreen.letterGradesAF')}</option>
                <option value="standards">{t('academicSettingsScreen.standardsBased')}</option>
              </select>
              <div className="flex items-center justify-between pt-2">
                <label className="text-sm font-medium text-gray-700">{t('academicSettingsScreen.enableWeightedAssignments')}</label>
                <input type="checkbox" checked={grading.weighted} onChange={e => setGrading(g => ({ ...g, weighted: e.target.checked }))} className="h-5 w-5 rounded text-indigo-600 focus:ring-indigo-500" />
              </div>
            </div>
          </Accordion>
          <Accordion title={t('academicSettingsScreen.enrollmentSettings')}>
            <p className="text-gray-600 text-sm">{t('academicSettingsScreen.configureAdmissionFormsRequiredDocumentsAndApp')}</p>
          </Accordion>

          <Accordion title={t('academicSettingsScreen.curriculumContent')}>
            <div className="space-y-3">
              <label className="text-sm font-medium text-gray-700">{t('academicSettingsScreen.primaryCurriculumType')}</label>
              {/* Was a dropdown offering KSSR / British / Both. The school has one
                  curriculum, so a dropdown was a way to select a syllabus the school
                  does not teach. The value is shown in the same place, in the same
                  shape as the control it replaces, so the layout does not move. */}
              <div
                className="w-full p-2 border border-gray-300 rounded-md bg-gray-50 text-gray-700"
                aria-label={t('academicSettingsScreen.primaryCurriculumType')}
              >
                {t('academicSettingsScreen.kurikulumKSSR')}
              </div>
              <p className="text-xs text-gray-500 italic mt-1">
                {t('academicSettingsScreen.thisSettingDeterminesTheDefaultSubjectListsAndTermStructuresUsedThroughoutTheSystem')}
              </p>
            </div>
          </Accordion>
        </>
      )}
    </div>
  );
};
export default AcademicSettingsScreen;
