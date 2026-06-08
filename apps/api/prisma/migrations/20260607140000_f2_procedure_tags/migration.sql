-- F2 (BE-2.2): tags associadas a procedimentos (relação N:N) — alimenta o
-- suggestProcedures e o auto-tagging (F3). Join implícita do Prisma `_ProcedureTags`.
-- CreateTable
CREATE TABLE "_ProcedureTags" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_ProcedureTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ProcedureTags_B_index" ON "_ProcedureTags"("B");

-- AddForeignKey
ALTER TABLE "_ProcedureTags" ADD CONSTRAINT "_ProcedureTags_A_fkey" FOREIGN KEY ("A") REFERENCES "procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProcedureTags" ADD CONSTRAINT "_ProcedureTags_B_fkey" FOREIGN KEY ("B") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
