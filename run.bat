@echo off
cd /d "%~dp0"
echo ================================
echo  Serene Panda - تشغيل المشروع
echo ================================
echo.

:: 1. تشغيل PostgreSQL إذا لم يكن شغال
echo [1/3] جاري التحقق من PostgreSQL...
"%ProgramFiles%\PostgreSQL\16\bin\pg_isready.exe" -h localhost -p 5433 -q 2>nul
if errorlevel 1 (
    echo [!] PostgreSQL غير شغال. جاري تشغيله...
    "%ProgramFiles%\PostgreSQL\16\bin\pg_ctl.exe" start -D "%ProgramFiles%\PostgreSQL\16\data" -w -t 10 2>nul
    if errorlevel 1 (
        echo [⚠] لم يتم تشغيل PostgreSQL تلقائياً. جارٍ المحاولة عبر net start...
        net start PostgreSQL 2>nul
    )
    timeout /t 3 /nobreak >nul
) else (
    echo [✓] PostgreSQL شغال على port 5433
)

:: 2. تشغيل MinIO إذا كان الملف موجوداً
if exist "minio.exe" (
    echo [2/3] جاري التحقق من MinIO...
    curl -s -o nul http://127.0.0.1:9000/minio/health/live 2>nul
    if errorlevel 1 (
        echo [✓] تم تشغيل MinIO على port 9000
        set MINIO_ROOT_USER=minioadmin
        set MINIO_ROOT_PASSWORD=minioadmin
        start /min "" minio.exe server minio-data --console-address :9001
    ) else (
        echo [✓] MinIO شغال على port 9000
    )
)

:: 3. تشغيل خادم التطوير
echo.
echo [3/3] جاري تشغيل الخادم...
echo.
echo   الموقع: http://localhost:3000
echo.
npm run dev
pause
