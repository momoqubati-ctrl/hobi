"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import AdminDataTable from "../shared/AdminDataTable";
import { getAdminHeaders } from "../utils";
import { FIELD_TRANSLATIONS, setFieldLanguage, getFieldLanguage } from "../constants";
import { showSuccess, showError } from "@/utils/toast";
import { Edit2, Trash2, Plus, Search, ChevronRight, ChevronLeft, RefreshCw, Database, Globe } from "lucide-react";

interface LegacyCpSectionProps {
  config: {
    title: string;
    description: string;
    tables: string[];
    actions?: string[];
  };
}

const LegacyCpSection = ({ config }: LegacyCpSectionProps) => {
  const [activeTable, setActiveTable] = useState(config.tables[0] || "");
  const [columns, setColumns] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [primaryKey, setPrimaryKey] = useState("id");
  const [loading, setLoading] = useState(false);
  
  // Pagination & Search
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  // Dialog State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"add" | "edit">("add");
  const [editingRow, setEditingRow] = useState<any>(null);
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete Alert State
  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<any>(null);
  const [lang, setLang] = useState<"ar" | "en">(getFieldLanguage);

  const toggleLang = () => {
    const next = lang === "ar" ? "en" : "ar";
    setLang(next);
    setFieldLanguage(next);
    loadTable(activeTable, offset);
  };

  const loadTable = async (table: string, currentOffset = 0) => {
    setActiveTable(table);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/database?table=${table}&limit=${limit}&offset=${currentOffset}`, {
        headers: getAdminHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setColumns(data.columns || []);
        setRows(data.rows || []);
        setTotalRows(data.totalRows || 0);
        setPrimaryKey(data.primaryKey || "id");
      } else {
        showError(data.message || "تعذر تحميل البيانات");
      }
    } catch (err) {
      console.error(err);
      showError("حدث خطأ أثناء تحميل جدول البيانات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setOffset(0);
    if (config.tables[0]) {
      loadTable(config.tables[0], 0);
    }
  }, [config.title, config.tables]);

  const handlePageChange = (direction: "next" | "prev") => {
    const nextOffset = direction === "next" ? offset + limit : Math.max(0, offset - limit);
    setOffset(nextOffset);
    loadTable(activeTable, nextOffset);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  // Open Dialog for Add Row
  const handleAddClick = () => {
    const initialForm: Record<string, any> = {};
    columns.forEach((col) => {
      // Set defaults based on datatype
      if (col.dataType === "boolean") {
        initialForm[col.name] = false;
      } else if (col.dataType.includes("int") || col.dataType === "numeric") {
        initialForm[col.name] = col.defaultValue !== null ? Number(col.defaultValue) : 0;
      } else {
        initialForm[col.name] = "";
      }
    });
    setFormValues(initialForm);
    setDialogMode("add");
    setEditingRow(null);
    setDialogOpen(true);
  };

  // Open Dialog for Edit Row
  const handleEditClick = (row: any) => {
    const editForm: Record<string, any> = {};
    columns.forEach((col) => {
      editForm[col.name] = row[col.name] !== null ? row[col.name] : "";
    });
    setFormValues(editForm);
    setDialogMode("edit");
    setEditingRow(row);
    setDialogOpen(true);
  };

  // Open Alert for Delete Row
  const handleDeleteClick = (row: any) => {
    setRowToDelete(row);
    setDeleteAlertOpen(true);
  };

  // Handle Save (Add or Update)
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      // Validate JSON fields if any
      const submissionData: Record<string, any> = {};
      for (const col of columns) {
        let val = formValues[col.name];
        
        // Exclude system fields on ADD mode
        if (dialogMode === "add") {
          if (col.name === "created_at" || col.name === "updated_at") continue;
          if (col.name === primaryKey && col.defaultValue !== null) continue;
        }

        if (col.dataType === "jsonb" && typeof val === "string" && val.trim()) {
          try {
            submissionData[col.name] = JSON.parse(val);
          } catch {
            showError(`الحقل ${FIELD_TRANSLATIONS[col.name] || col.name} ليس JSON صالح`);
            setIsSubmitting(false);
            return;
          }
        } else if (col.dataType.includes("int") || col.dataType === "numeric") {
          submissionData[col.name] = val !== "" ? Number(val) : null;
        } else if (col.dataType === "boolean") {
          submissionData[col.name] = Boolean(val);
        } else {
          submissionData[col.name] = val === "" ? null : val;
        }
      }

      let res;
      if (dialogMode === "add") {
        res = await fetch(`/api/admin/database?table=${activeTable}`, {
          method: "POST",
          headers: {
            ...getAdminHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(submissionData),
        });
      } else {
        const pkValue = editingRow[primaryKey];
        // Don't modify the primary key itself
        delete submissionData[primaryKey];

        res = await fetch(`/api/admin/database?table=${activeTable}`, {
          method: "PUT",
          headers: {
            ...getAdminHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pkValue,
            data: submissionData,
          }),
        });
      }

      const data = await res.json();
      if (data.success) {
        showSuccess(dialogMode === "add" ? "تم إضافة السجل بنجاح" : "تم تحديث السجل بنجاح");
        setDialogOpen(false);
        loadTable(activeTable, offset);
      } else {
        showError(data.message || "فشلت العملية");
      }
    } catch (err) {
      console.error(err);
      showError("حدث خطأ أثناء حفظ البيانات");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Delete
  const handleConfirmDelete = async () => {
    if (!rowToDelete) return;
    const pkValue = rowToDelete[primaryKey];
    try {
      const res = await fetch(`/api/admin/database?table=${activeTable}&id=${encodeURIComponent(pkValue)}`, {
        method: "DELETE",
        headers: getAdminHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess("تم حذف السجل بنجاح");
        setDeleteAlertOpen(false);
        setRowToDelete(null);
        loadTable(activeTable, offset);
      } else {
        showError(data.message || "فشل حذف السجل");
      }
    } catch (err) {
      console.error(err);
      showError("حدث خطأ أثناء حذف البيانات");
    }
  };

  // Search filter
  const filteredRows = rows.filter((row) => {
    if (!searchQuery) return true;
    return Object.values(row).some((val) =>
      String(val ?? "").toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const columnsWithActions = [
    ...columns.map((col) => ({
      key: col.name,
      label: FIELD_TRANSLATIONS[col.name] || col.name,
      render: (val: any) => {
        if (typeof val === "boolean") {
          return val ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">نعم</span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400">لا</span>
          );
        }
        if (typeof val === "object" && val !== null) {
          return <span className="font-mono text-xs">{JSON.stringify(val)}</span>;
        }
        return String(val ?? "-");
      },
    })),
    {
      key: "actions",
      label: "العمليات الإدارية",
      render: (_: any, row: any) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-xl text-primary hover:bg-primary/10"
            onClick={() => handleEditClick(row)}
          >
            <Edit2 size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-xl text-red-500 hover:bg-red-500/10"
            onClick={() => handleDeleteClick(row)}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 animate-in fade-in duration-500 text-right">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm">
        <div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 justify-end lg:justify-start">
            <Database size={24} className="text-primary" />
            {config.title}
          </h2>
          <p className="text-sm font-medium text-muted-foreground mt-1">{config.description}</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-start lg:justify-end">
          {config.tables.map((table) => (
            <Button
              key={table}
              variant={activeTable === table ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setOffset(0);
                loadTable(table, 0);
              }}
              className="rounded-2xl font-bold text-xs whitespace-nowrap px-4 py-2"
            >
              {FIELD_TRANSLATIONS[table] || table}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleLang}
            className="rounded-2xl font-bold text-xs whitespace-nowrap px-3 py-2 gap-1"
            title={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
          >
            <Globe size={14} />
            {lang === "ar" ? "EN" : "عربي"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <div className="relative w-full md:w-80">
          <Search className="absolute right-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
          <Input
            placeholder="بحث في الحقول المحلية..."
            className="pr-10 rounded-2xl border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
            value={searchQuery}
            onChange={handleSearchChange}
          />
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => loadTable(activeTable, offset)}
            className="rounded-2xl h-10 w-10 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "animate-spin text-muted-foreground" : "text-slate-600"} />
          </Button>

          <Button
            onClick={handleAddClick}
            className="rounded-2xl font-black flex items-center gap-2 px-5 py-2 shadow-lg shadow-primary/10"
          >
            <Plus size={16} />
            إضافة سجل جديد
          </Button>
        </div>
      </div>

      <Card className="border-none shadow-xl shadow-slate-200/50 dark:shadow-none rounded-3xl overflow-hidden bg-white dark:bg-slate-900">
        <CardContent className="p-0">
          <AdminDataTable columns={columnsWithActions} rows={filteredRows} loading={loading} />
        </CardContent>
      </Card>

      {/* Pagination Footer */}
      {!loading && totalRows > limit && (
        <div className="flex items-center justify-between px-2 py-4">
          <span className="text-xs font-bold text-slate-500">
            عرض {offset + 1} - {Math.min(offset + limit, totalRows)} من أصل {totalRows}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => handlePageChange("prev")}
              className="rounded-xl font-bold flex items-center gap-1 bg-white dark:bg-slate-900"
            >
              <ChevronRight size={16} />
              السابق
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + limit >= totalRows}
              onClick={() => handlePageChange("next")}
              className="rounded-xl font-bold flex items-center gap-1 bg-white dark:bg-slate-900"
            >
              التالي
              <ChevronLeft size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg rounded-3xl p-6 text-right bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rtl">
          <DialogHeader>
            <DialogTitle className="text-lg font-black text-slate-800 dark:text-slate-100">
              {dialogMode === "add" ? "إضافة سجل جديد" : "تعديل السجل"}
            </DialogTitle>
            <DialogDescription className="text-xs font-medium text-slate-400">
              أدخل قيم الحقول للجدول المختار. يرجى مطابقة الصيغ الصحيحة.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 my-4 max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin">
            {columns.map((col) => {
              // Exclude some automatic columns on ADD mode
              if (dialogMode === "add") {
                if (col.name === "created_at" || col.name === "updated_at") return null;
                if (col.name === primaryKey && col.defaultValue !== null) return null;
              }
              // Disable primary key in edit mode
              const isPkDisabled = dialogMode === "edit" && col.name === primaryKey;

              const translation = FIELD_TRANSLATIONS[col.name] || col.name;

              return (
                <div key={col.name} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground font-mono">{col.dataType}</span>
                    <Label htmlFor={col.name} className="font-bold text-xs text-slate-700 dark:text-slate-300">
                      {translation} {col.nullable ? "" : <span className="text-red-500">*</span>}
                    </Label>
                  </div>

                  {col.dataType === "boolean" ? (
                    <div className="flex items-center justify-end gap-3 py-2">
                      <span className="text-xs text-slate-400 font-medium">{formValues[col.name] ? "نشط / نعم" : "معطل / لا"}</span>
                      <Switch
                        id={col.name}
                        checked={!!formValues[col.name]}
                        onCheckedChange={(checked) => setFormValues({ ...formValues, [col.name]: checked })}
                        disabled={isPkDisabled}
                      />
                    </div>
                  ) : col.dataType === "jsonb" ? (
                    <Textarea
                      id={col.name}
                      value={typeof formValues[col.name] === "object" ? JSON.stringify(formValues[col.name]) : formValues[col.name]}
                      onChange={(e) => setFormValues({ ...formValues, [col.name]: e.target.value })}
                      placeholder='{"key": "value"}'
                      className="font-mono text-xs rounded-xl bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                      disabled={isPkDisabled}
                      rows={3}
                    />
                  ) : col.name === "msg" || col.name === "about" || col.name === "description" ? (
                    <Textarea
                      id={col.name}
                      value={formValues[col.name]}
                      onChange={(e) => setFormValues({ ...formValues, [col.name]: e.target.value })}
                      className="rounded-xl border-slate-200 dark:border-slate-800"
                      disabled={isPkDisabled}
                      rows={3}
                      required={!col.nullable}
                    />
                  ) : (
                    <Input
                      id={col.name}
                      type={col.dataType.includes("int") || col.dataType === "numeric" ? "number" : "text"}
                      value={formValues[col.name]}
                      onChange={(e) => setFormValues({ ...formValues, [col.name]: e.target.value })}
                      className="rounded-xl border-slate-200 dark:border-slate-800 h-10"
                      disabled={isPkDisabled}
                      required={!col.nullable}
                    />
                  )}
                </div>
              );
            })}

            <DialogFooter className="mt-6 flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                className="rounded-2xl font-bold"
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="rounded-2xl font-black px-6 shadow-lg shadow-primary/20"
              >
                {isSubmitting ? "جاري الحفظ..." : "حفظ التغييرات"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert */}
      <AlertDialog open={deleteAlertOpen} onOpenChange={setDeleteAlertOpen}>
        <AlertDialogContent className="rounded-3xl p-6 text-right bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center justify-end gap-2">
              <span className="text-red-500">تأكيد عملية الحذف</span>
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-slate-500 font-medium">
              هل أنت متأكد من رغبتك في حذف هذا السجل نهائياً؟ لا يمكن التراجع عن هذا الإجراء وسيتم مسحه من قاعدة البيانات بشكل كامل.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 flex gap-2 justify-end">
            <AlertDialogCancel className="rounded-2xl font-bold">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="rounded-2xl font-black bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20"
            >
              حذف السجل
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default LegacyCpSection;