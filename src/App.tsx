import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import { ProtectedRoute } from './components/layout/ProtectedRoute';

// Auth/Public
import { Login } from './pages/Login';
import { ResetPassword } from './pages/ResetPassword';
import { PublicValidation, Me, Notifications } from './pages/Auxiliary';
import { MagicLinkApprove } from './pages/MagicLinkApprove';
import { NoAccess } from './pages/NoAccess';

// Core
import { Dashboard } from './pages/Dashboard';
import { Contracts } from './pages/Contracts';
import { ContractDetail } from './pages/ContractDetail';
import { ContractForm } from './pages/ContractForm';
import { ContractLots } from './pages/ContractLots';
import { ContractParties } from './pages/ContractParties';
import { ContractSheet } from './pages/ContractSheet';
import { SovImportWizard } from './pages/SovImportWizard';
import { Measurements } from './pages/Measurements';
import { MeasurementDetail } from './pages/MeasurementDetail';
import { MeasurementMemoryPage } from './pages/MeasurementMemoryPage';

// Contract submodules (placeholders + AdditiveDetail)
import {
  AdditiveDetail,
  Tracking, Reports as ContractReports,
} from './pages/contracts';
import { Financial } from './pages/Financial';
import { Schedule } from './pages/Schedule';
import { Portfolio } from './pages/Portfolio';
import { Pendencias } from './pages/Pendencias';
import { MyApprovals } from './pages/MyApprovals';
import { Reports } from './pages/Reports';
import { Eap } from './pages/Eap';
import { SovVersionCompare } from './pages/SovVersionCompare';
import { AdminPrograms } from './pages/admin/Programs';
import { AdminDisciplines } from './pages/admin/Disciplines';
import { AdminAuditLog } from './pages/admin/AuditLog';
import { Additives } from './pages/Additives';
import { UnforeseenList, UnforeseenDetail } from './pages/UnforeseenItems';
import { MeasurementApprovePage } from './pages/MeasurementApprovePage';
import { WorkflowsAdmin } from './pages/admin/WorkflowsAdmin';

// GED
import { Ged, GedCategories, GedDocument, GedDistribution, GedTerms, GedDistributionWizard, GedDistributionDetail } from './pages/ged';
import { GedUploadWizard, GedRevisionUpload } from './pages/ged/UploadWizard';

// Admin
import { AdminUsers, AdminTenants, Workflows, Backlog } from './pages/admin';

function P({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  return <ProtectedRoute roles={roles}>{children}</ProtectedRoute>;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/login"           element={<Login />} />
        <Route path="/reset-password"  element={<ResetPassword />} />
        <Route path="/v/:code"         element={<PublicValidation />} />
        <Route path="/aprovar/:token"  element={<MagicLinkApprove />} />
        <Route path="/no-access"       element={<NoAccess />} />

        {/* Root redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Core */}
        <Route path="/dashboard"          element={<P><Dashboard /></P>} />
        <Route path="/carteira"           element={<P><Portfolio /></P>} />
        <Route path="/pendencias"         element={<P><Pendencias /></P>} />
        <Route path="/aprovacoes"         element={<P><MyApprovals /></P>} />
        <Route path="/relatorios"         element={<P><Reports /></P>} />
        <Route path="/me"                 element={<P><Me /></P>} />
        <Route path="/notifications"      element={<P><Notifications /></P>} />

        {/* Contracts */}
        <Route path="/contratos"                              element={<P><Contracts /></P>} />
        <Route path="/contratos/novo"                         element={<P roles={['admin', 'gestor_contrato']}><ContractForm /></P>} />
        <Route path="/contratos/:id"                          element={<P><ContractDetail /></P>} />
        <Route path="/contratos/:id/editar"                   element={<P roles={['admin', 'gestor_contrato']}><ContractForm /></P>} />
        <Route path="/contratos/:id/obras"                    element={<P><ContractLots /></P>} />
        <Route path="/contratos/:id/partes"                   element={<P><ContractParties /></P>} />
        <Route path="/contratos/:id/planilha"                 element={<P><ContractSheet /></P>} />
        <Route path="/contratos/:id/planilha/importar"        element={<P roles={['admin', 'gestor_contrato']}><SovImportWizard /></P>} />
        <Route path="/contratos/:id/medicoes"                 element={<P><Measurements /></P>} />
        <Route path="/contratos/:id/medicoes/:medId"          element={<P><MeasurementDetail /></P>} />
        <Route path="/contratos/:id/medicoes/:medId/memoria/:itemId" element={<P><MeasurementMemoryPage /></P>} />
        <Route path="/contratos/:id/medicoes/:medId/aprovar"  element={<P><MeasurementApprovePage /></P>} />
        <Route path="/contratos/:id/aditivos"                 element={<P><Additives /></P>} />
        <Route path="/contratos/:id/aditivos/:adId"           element={<P><AdditiveDetail /></P>} />
        <Route path="/contratos/:id/itens-nao-previstos"      element={<P><UnforeseenList /></P>} />
        <Route path="/contratos/:id/itens-nao-previstos/:itemId" element={<P><UnforeseenDetail /></P>} />
        <Route path="/contratos/:id/rastreamento/:itemContratualId" element={<P><Tracking /></P>} />
        <Route path="/contratos/:id/financeiro"               element={<P><Financial /></P>} />
        <Route path="/contratos/:id/cronograma"               element={<P><Schedule /></P>} />
        <Route path="/contratos/:id/eap"                      element={<P><Eap /></P>} />
        <Route path="/contratos/:id/planilha/versoes"         element={<P><SovVersionCompare /></P>} />
        <Route path="/contratos/:id/relatorios"               element={<P><ContractReports /></P>} />

        {/* GED */}
        <Route path="/ged"                       element={<P><Ged /></P>} />
        <Route path="/ged/categorias"            element={<P><GedCategories /></P>} />
        <Route path="/ged/termos"                element={<P><GedTerms /></P>} />
        <Route path="/ged/documentos/novo"       element={<P><GedUploadWizard /></P>} />
        <Route path="/ged/documentos/:docId"     element={<P><GedDocument /></P>} />
        <Route path="/ged/documentos/:docId/nova-revisao" element={<P><GedRevisionUpload /></P>} />
        <Route path="/ged/distribuicao"          element={<P><GedDistribution /></P>} />
        <Route path="/ged/distribuicao/nova"      element={<P><GedDistributionWizard /></P>} />
        <Route path="/ged/distribuicao/:grdId"    element={<P><GedDistributionDetail /></P>} />

        {/* Admin */}
        <Route path="/admin/users"               element={<P roles={['admin']}><AdminUsers /></P>} />
        <Route path="/admin/tenants"             element={<P roles={['admin']}><AdminTenants /></P>} />
        <Route path="/admin/contratos/workflows" element={<P roles={['admin']}><WorkflowsAdmin /></P>} />
        <Route path="/admin/programs"            element={<P roles={['admin', 'gestor_contrato']}><AdminPrograms /></P>} />
        <Route path="/admin/disciplines"         element={<P roles={['admin', 'gestor_contrato']}><AdminDisciplines /></P>} />
        <Route path="/admin/auditoria"           element={<P roles={['admin']}><AdminAuditLog /></P>} />
        <Route path="/admin/backlog"             element={<P roles={['admin']}><Backlog /></P>} />

        {/* 404 fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
