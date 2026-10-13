import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ShieldCheckIcon, CalendarIcon, DollarSignIcon, MegaphoneIcon, BriefcaseIcon, PaintBrushIcon, ChevronRightIcon, UserGroupIcon, UserIcon as ProfileIcon, ElearningIcon, ClockIcon, DocumentTextIcon } from '../../constants';
import { UserPlus, Sparkles, CreditCard } from 'lucide-react';

interface SystemSettingsScreenProps {
  navigateTo: (view: string, title: string, props?: any) => void;
}

const settingsCategories = [
  { view: 'upgrade', titleKey: 'systemSettingsScreen.billingPlan', descriptionKey: 'systemSettingsScreen.viewYourCurrentTermManageYourPlanAndUpgrade', icon: <CreditCard className="h-6 w-6" />, color: 'text-green-600 bg-green-100' },
  { view: 'appearanceSettings', titleKey: 'systemSettingsScreen.appearanceTheme', descriptionKey: 'Switch Normal or Liquid Glass, and change the app accent colour.', icon: <Sparkles className="h-6 w-6" />, color: 'text-indigo-500 bg-indigo-100' },
  { view: 'studentList', titleKey: 'systemSettingsScreen.studentManagement', descriptionKey: 'systemSettingsScreen.manageStudentRecordsAndEnrollment', icon: <UserGroupIcon />, color: 'text-blue-500 bg-blue-100' },
  { view: 'teacherList', titleKey: 'systemSettingsScreen.manageTeachers', descriptionKey: 'systemSettingsScreen.manageTeacherProfilesAndAssignments', icon: <ProfileIcon />, color: 'text-purple-500 bg-purple-100' },
  { view: 'parentList', titleKey: 'systemSettingsScreen.parentManagement', descriptionKey: 'systemSettingsScreen.manageParentInformationAndLinks', icon: <UserGroupIcon />, color: 'text-orange-500 bg-orange-100' },
  { view: 'inviteStaff', titleKey: 'systemSettingsScreen.inviteStaffMember', descriptionKey: 'systemSettingsScreen.sendInvitationsToNewStaffMembers', icon: <BriefcaseIcon />, color: 'text-emerald-500 bg-emerald-100' },
  { view: 'classList', titleKey: 'systemSettingsScreen.classManagement', descriptionKey: 'systemSettingsScreen.manageSchoolClassesAndSections', icon: <ElearningIcon />, color: 'text-pink-500 bg-pink-100' },
  { view: 'timetable', titleKey: 'systemSettingsScreen.timetableManagement', descriptionKey: 'systemSettingsScreen.viewAndEditSchoolSchedules', icon: <ClockIcon />, color: 'text-cyan-500 bg-cyan-100' },
  { view: 'examManagement', titleKey: 'systemSettingsScreen.examManagement', descriptionKey: 'systemSettingsScreen.manageExamsAndResults', icon: <DocumentTextIcon />, color: 'text-rose-500 bg-rose-100' },
  { view: 'communicationHub', titleKey: 'systemSettingsScreen.communicationHub', descriptionKey: 'systemSettingsScreen.broadcastMessagesAndAnnouncements', icon: <MegaphoneIcon />, color: 'text-amber-500 bg-amber-100' },
  { view: 'userRoles', titleKey: 'systemSettingsScreen.userRolesPermissions', descriptionKey: 'systemSettingsScreen.defineRolesAndControlAccess', icon: <ShieldCheckIcon />, color: 'text-slate-500 bg-slate-100' },
  { view: 'academicSettings', titleKey: 'systemSettingsScreen.academicConfiguration', descriptionKey: 'systemSettingsScreen.setCalendarGradingAndCourses', icon: <CalendarIcon />, color: 'text-blue-600 bg-blue-100' },
  { view: 'learningHubManagement', titleKey: 'systemSettingsScreen.learningHub', descriptionKey: 'systemSettingsScreen.curateFreeStudyResourcesByLevelAndSubject', icon: <ElearningIcon />, color: 'text-indigo-600 bg-indigo-100' },
  { view: 'termsAndGrading', titleKey: 'systemSettingsScreen.termsGrading', descriptionKey: 'systemSettingsScreen.setAcademicTermsAndTheGradingScalePerSchoolOrB', icon: <CalendarIcon />, color: 'text-indigo-600 bg-indigo-100' },
  { view: 'financialSettings', titleKey: 'systemSettingsScreen.financialSettings', descriptionKey: 'systemSettingsScreen.manageFeesAndPaymentMethods', icon: <DollarSignIcon />, color: 'text-green-500 bg-green-100' },
  { view: 'securitySettings', titleKey: 'systemSettingsScreen.securityCompliance', descriptionKey: 'systemSettingsScreen.passwordPolicies2FAAuditLogs', icon: <ShieldCheckIcon />, color: 'text-red-500 bg-red-100' },
  { view: 'profileSettings', titleKey: 'systemSettingsScreen.personalProfileSettings', descriptionKey: 'systemSettingsScreen.updateYourAccountAndProfileInformation', icon: <ProfileIcon />, color: 'text-gray-500 bg-gray-100' },
  { view: 'brandingSettings', titleKey: 'systemSettingsScreen.brandingCustomization', descriptionKey: 'systemSettingsScreen.customizeTheLookAndFeel', icon: <PaintBrushIcon />, color: 'text-violet-500 bg-violet-100' },
  { view: 'analyticsAdminTools', titleKey: 'systemSettingsScreen.analyticsAdminTools', descriptionKey: 'systemSettingsScreen.advancedAnalyticsBudgetsIntegrations', icon: <BriefcaseIcon />, color: 'text-teal-500 bg-teal-100' },
  { view: 'selectUserTypeToAdd', titleKey: 'systemSettingsScreen.addNewUser', descriptionKey: 'systemSettingsScreen.quicklyAddANewStudentTeacherOrParent', icon: <UserPlus className="h-6 w-6" />, color: 'text-blue-600 bg-blue-100' },
  { view: 'versionSettings', titleKey: 'systemSettingsScreen.platformVersionManagement', descriptionKey: 'systemSettingsScreen.selectAndLockYourPreferredPlatformVersion', icon: <ShieldCheckIcon />, color: 'text-indigo-500 bg-indigo-100' },
];

const SystemSettingsScreen: React.FC<SystemSettingsScreenProps> = ({ navigateTo }) => {
  const { t } = useTranslation();
  return (
    <div className="p-4 space-y-3 bg-gray-50 pb-32 lg:pb-4">
      {settingsCategories.map((cat, ci) => (
        <motion.button
          key={cat.view}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(ci, 15) * 0.03 }}
          whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
          onClick={() => navigateTo(cat.view, t(cat.titleKey), {})}
          className="w-full bg-white rounded-xl shadow-sm p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center space-x-4">
            <div className={`p-3 rounded-lg ${cat.color}`}>
              {React.cloneElement(cat.icon, { className: 'h-6 w-6' })}
            </div>
            <div>
              <h3 className="font-bold text-gray-800">{t(cat.titleKey)}</h3>
              <p className="text-sm text-gray-500">{t(cat.descriptionKey)}</p>
            </div>
          </div>
          <ChevronRightIcon className="text-gray-400" />
        </motion.button>
      ))}
    </div>
  );
};
export default SystemSettingsScreen;
