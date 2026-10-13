
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import {
    listPermissions,
    listRolePermissions,
    setRolePermissions,
    type RoleCode,
} from '../../src/lib/supabase/roles';
import { useAutoSync } from '../../hooks/useAutoSync';
import { useAuth } from '../../context/AuthContext';
import {
    ExamIcon, AttendanceIcon, ReportIcon, MegaphoneIcon, BookOpenIcon,
    ViewGridIcon, BusIcon, ReceiptIcon, UsersIcon, AnalyticsIcon, AIIcon
} from '../../constants';

const PermissionToggle = ({ enabled, onToggle, disabled = false }: { enabled: boolean, onToggle: () => void, disabled?: boolean }) => (
    <motion.button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        disabled={disabled}
        whileTap={!disabled ? { scale: 0.92 } : {}}
        className={`relative inline-flex items-center h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 ${enabled ? 'bg-sky-600' : 'bg-gray-300'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
        <motion.span
            aria-hidden="true"
            layout
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 ${enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
        />
    </motion.button>
);

/**
 * The roles this school actually has.
 *
 * WHAT WAS HERE BEFORE, and why it could not be kept. The screen carried its own
 * catalogue: roles called Admin, Teacher, Student and Parent, and permissions called
 * "manage-users", "mark-attendance", "view-analytics". NONE of those exist. The
 * database has three roles — ADMIN, TEACHER, GUARDIAN — and 42 permission codes like
 * `assessments.enter_scores` and `attendance.record`.
 *
 * So the screen was a switch panel for a permission system that is not this one. Every
 * switch it showed described something the database had never heard of, which is why
 * saving it could never have worked even with a live server: there was nothing to
 * save it TO. The permission codes shown now are the ones `has_permission` reads.
 */
const ROLE_LABELS: { code: RoleCode; name: string; descriptionKey: string; icon: React.FC<any> }[] = [
    {
        code: 'ADMIN',
        name: 'Administrator',
        descriptionKey: 'userRolesScreen.theOfficeFullAccessAndTheOnlyRoleThatCannotBeR',
        icon: UsersIcon,
    },
    {
        code: 'TEACHER',
        name: 'Teacher',
        descriptionKey: 'userRolesScreen.seesTheirOwnClassesAndRecordsAttendanceAndMark',
        icon: BookOpenIcon,
    },
    {
        code: 'GUARDIAN',
        name: 'Guardian',
        descriptionKey: 'A parent or guardian. Sees only their own children.',
        icon: UsersIcon,
    },
];

/**
 * A short label for a permission code.
 *
 * Derived from the code rather than a hand-written list, because a hand-written list
 * is what went stale and became fiction. `assessments.enter_scores` becomes
 * "Assessments - Enter scores". If a permission is added to the database it appears
 * here without anyone remembering to add it.
 */
function permissionLabel(code: string): string {
    const [group, ...rest] = code.split('.');
    const groupName = group.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    const action = rest.join('.').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    return action ? `${groupName} — ${action}` : groupName;
}

const UserRolesScreen: React.FC = () => {
    const { t } = useTranslation();
    const { currentSchool } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    // Every permission, from the database, and which role holds it.
    const [allPermissions, setAllPermissions] = useState<string[]>([]);
    // Starts EMPTY, not seeded from code defaults. A default that looks like a stored
    // value is how the old screen agreed with a save that never happened.
    const [permissionsState, setPermissionsState] = useState<Record<string, Record<string, boolean>>>({});

    // Unified Backend-driven Auto Sync
    useAutoSync(['role_permissions'], () => {
        console.log('🔄 [UserRolesScreen] Auto-sync triggered');
        fetchPermissions();
    });

    const fetchPermissions = async () => {
        try {
            // The database's grants, which are what `has_permission` actually reads.
            //
            // This screen shows the code's built-in defaults until this resolves, which
            // is what made the old behaviour so convincing: the switches looked right,
            // and saving wrote to a server that is not deployed. What is stored here is
            // now the truth, whatever the defaults say.
            const [perms, grants] = await Promise.all([
                listPermissions(),
                listRolePermissions(),
            ]);

            const codes = perms.map(p => p.code);
            setAllPermissions(codes);

            // Every permission starts OFF and is turned on only by a grant that is
            // actually stored. Absence is OFF — the table records grants, not
            // decisions, and reading absence as "keep the code's default" is exactly
            // how the old screen agreed with a save that never happened.
            const next: Record<string, Record<string, boolean>> = {};
            for (const role of ROLE_LABELS) {
                next[role.code] = {};
                for (const code of codes) next[role.code]![code] = false;
            }
            for (const g of grants) {
                if (next[g.roleCode] && g.permissionCode in next[g.roleCode]!) {
                    next[g.roleCode]![g.permissionCode] = true;
                }
            }
            setPermissionsState(next);
        } catch (err) {
            console.error("Failed to load permissions:", err);
        }
    };

    useEffect(() => {
        fetchPermissions();
    }, [currentSchool?.id]);

    const handleToggle = (roleId: RoleCode, permId: string) => {
        // ADMIN is not editable here, and the database refuses it too. The office
        // removing a permission from ADMIN could lock every admin out of the screen
        // that would put it back, including whoever did it.
        if (roleId === 'ADMIN') return;
        setPermissionsState(prev => ({
            ...prev,
            [roleId]: {
                ...prev[roleId],
                [permId]: !prev[roleId]![permId],
            },
        }));
    };

    const handleSave = async () => {
        if (!currentSchool?.id) {
            toast.error(t('userRolesScreen.schoolContextMissing'));
            return;
        }
        setIsLoading(true);

        try {
            // The whole switch panel is sent, because turning one OFF is a decision
            // this screen has to express and a grant that is simply absent cannot say
            // "off". ADMIN is skipped here AND refused in the database: the office
            // removing a permission from ADMIN could lock every admin out of the very
            // screen that would put it back, including whoever did it.
            const changes: { roleCode: RoleCode; permissionCode: string; enabled: boolean }[] = [];
            for (const role of ROLE_LABELS) {
                if (role.code === 'ADMIN') continue;
                const rolePerms = permissionsState[role.code];
                if (!rolePerms) continue;
                for (const permId of Object.keys(rolePerms)) {
                    changes.push({
                        roleCode: role.code,
                        permissionCode: permId,
                        enabled: Boolean(rolePerms[permId]),
                    });
                }
            }

            await setRolePermissions(changes);
            toast.success(t('userRolesScreen.permissionsSavedSuccessfully'));
            // Read back, so the screen shows what is stored rather than the guess.
            await fetchPermissions();
        } catch (error: any) {
            console.error('Save failed:', error);
            toast.error('Failed to save: ' + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <main className="flex-grow p-4 space-y-4 overflow-y-auto pb-20">
                {allPermissions.length === 0 && (
                    <p className="text-center py-10 text-gray-500">{t('userRolesScreen.loadingPermissions')}</p>
                )}
                {ROLE_LABELS.map((role, ri) => {
                    const IconComponent = role.icon;
                    return (
                        <motion.div key={role.code} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: ri * 0.05 }} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                            <div className="p-4 flex items-center space-x-4 bg-gray-50 border-b border-gray-200">
                                <div className="text-sky-500">
                                    <IconComponent className="h-8 w-8" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-gray-800">{role.name}</h3>
                                    <p className="text-sm text-gray-500">{t(role.descriptionKey)}</p>
                                </div>
                            </div>
                            <ul className="divide-y divide-gray-100 p-2">
                                {allPermissions.map(code => (
                                    <li key={code} className="flex justify-between items-center p-3">
                                        <div className="flex items-center space-x-3">
                                            <span className="font-medium text-gray-700">{permissionLabel(code)}</span>
                                        </div>
                                        <PermissionToggle
                                            enabled={permissionsState[role.code]?.[code] ?? false}
                                            onToggle={() => handleToggle(role.code, code)}
                                            disabled={role.code === 'ADMIN'}
                                        />
                                    </li>
                                ))}
                            </ul>
                        </motion.div>
                    );
                })}
            </main>

            <div className="p-4 bg-white border-t border-gray-200 sticky bottom-0">
                <motion.button
                    whileHover={!isLoading ? { scale: 1.01 } : {}}
                    whileTap={!isLoading ? { scale: 0.98 } : {}}
                    onClick={handleSave}
                    disabled={isLoading}
                    className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm font-medium text-white ${isLoading ? 'bg-sky-400' : 'bg-sky-500 hover:bg-sky-600'} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 transition-colors`}
                >
                    {isLoading ? t('userRolesScreen.saving') : t('userRolesScreen.saveChanges')}
                </motion.button>
            </div>
        </div>
    );
};

export default UserRolesScreen;