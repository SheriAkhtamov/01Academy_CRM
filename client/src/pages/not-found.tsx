import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="min-h-[60vh] w-full flex items-center justify-center">
      <Card className="w-full max-w-md mx-4 hover-lift">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-red-50 flex items-center justify-center">
            <AlertCircle className="h-7 w-7 text-red-500" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900 tracking-tight">{t('pageNotFound')}</h1>
          <p className="mt-2 text-sm text-slate-500">{t('pageNotFoundDescription')}</p>
          <Link href="/">
            <Button className="mt-6">{t('dashboard')}</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
