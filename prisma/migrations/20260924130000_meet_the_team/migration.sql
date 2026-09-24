-- Meet the Team: public roster separate from User / SalesRep auth & CRM

CREATE TABLE "TeamDepartment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamDepartment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "jobTitle" TEXT,
    "bio" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "linkedInUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isContactable" BOOLEAN NOT NULL DEFAULT false,
    "departmentId" TEXT,
    "photoMediaId" TEXT,
    "photoAlt" TEXT,
    "photoFocalX" INTEGER NOT NULL DEFAULT 50,
    "photoFocalY" INTEGER NOT NULL DEFAULT 50,
    "salesRepId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamDepartment_slug_key" ON "TeamDepartment"("slug");
CREATE INDEX "TeamDepartment_sortOrder_idx" ON "TeamDepartment"("sortOrder");
CREATE INDEX "TeamDepartment_isPublic_idx" ON "TeamDepartment"("isPublic");

CREATE UNIQUE INDEX "TeamMember_salesRepId_key" ON "TeamMember"("salesRepId");
CREATE INDEX "TeamMember_departmentId_sortOrder_idx" ON "TeamMember"("departmentId", "sortOrder");
CREATE INDEX "TeamMember_isPublic_isFeatured_idx" ON "TeamMember"("isPublic", "isFeatured");
CREATE INDEX "TeamMember_sortOrder_idx" ON "TeamMember"("sortOrder");

ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "TeamDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_photoMediaId_fkey" FOREIGN KEY ("photoMediaId") REFERENCES "CmsMedia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "SalesRep"("id") ON DELETE SET NULL ON UPDATE CASCADE;
