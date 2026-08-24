import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { SPRING, fadeInUp, staggerContainer } from "@/lib/motion";

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="min-h-[60dvh] w-full flex items-center justify-center">
      <motion.div
        className="w-full max-w-md mx-4"
        variants={staggerContainer(0.07, 0.04)}
        initial="hidden"
        animate="visible"
      >
        <Card className="hover-lift">
          <CardContent className="pt-8 pb-8 text-center">
            {/* The icon overshoots on arrival. A 404 is a dead end, and a bit
                of character here keeps it from reading as a crash. */}
            <motion.div
              className="mx-auto h-14 w-14 rounded-2xl bg-destructive/10 flex items-center justify-center"
              initial={{ scale: 0.3, opacity: 0, rotate: -20 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={SPRING.bouncy}
            >
              <AlertCircle className="h-7 w-7 text-destructive" />
            </motion.div>
            <motion.h1
              variants={fadeInUp}
              className="mt-4 text-2xl font-bold text-foreground tracking-tight"
            >
              {t('pageNotFound')}
            </motion.h1>
            <motion.p variants={fadeInUp} className="mt-2 text-sm text-muted-foreground">
              {t('pageNotFoundDescription')}
            </motion.p>
            <motion.div variants={fadeInUp}>
              <Link href="/">
                <Button className="mt-6">{t('dashboard')}</Button>
              </Link>
            </motion.div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
