import type { RequestHandler } from "express";
import { sendSuccess } from "../../shared/http/envelopes.js";
import type { Identity } from "../auth/auth.service.js";
import * as service from "./catalog.service.js";
import { productListSchema, publicProductListSchema } from "./catalog.schemas.js";
import { categoryListSchema } from "./catalog.schemas.js";

function userId(responseLocals: Record<string, unknown>): string {
  return (responseLocals.auth as Identity).id;
}

export const listPublicCategories: RequestHandler = async (_request, response) => {
  const categories = await service.listCategories(false);
  sendSuccess(response, { categories });
};

export const listAdminCategories: RequestHandler = async (request, response) => {
  const query = categoryListSchema.parse(request.query);
  const categories = await service.listCategories(query.includeArchived === "true");
  sendSuccess(response, { categories });
};

export const getCategory: RequestHandler = async (request, response) => {
  const category = await service.getCategory(request.params.slug as string);
  sendSuccess(response, { category });
};

export const createCategory: RequestHandler = async (request, response) => {
  const category = await service.createCategory(request.body);
  sendSuccess(response, { category }, 201);
};

export const updateCategory: RequestHandler = async (request, response) => {
  const category = await service.updateCategory(request.params.id as string, request.body);
  sendSuccess(response, { category });
};

export const archiveCategory: RequestHandler = async (request, response) => {
  const category = await service.archiveCategory(request.params.id as string);
  sendSuccess(response, { category });
};

export const listVendorProducts: RequestHandler = async (request, response) => {
  const { page, limit } = productListSchema.parse(request.query);
  const result = await service.listVendorProducts(userId(response.locals), page, limit);
  sendSuccess(response, { products: result.items }, 200, {
    page,
    limit,
    total: result.total,
    totalPages: Math.ceil(result.total / limit),
  });
};

export const createProduct: RequestHandler = async (request, response) => {
  const product = await service.createProduct(userId(response.locals), request.body);
  sendSuccess(response, { product }, 201);
};

export const getVendorProduct: RequestHandler = async (request, response) => {
  const product = await service.getVendorProduct(userId(response.locals), request.params.id as string);
  sendSuccess(response, { product });
};

export const updateVendorProduct: RequestHandler = async (request, response) => {
  const product = await service.updateVendorProduct(userId(response.locals), request.params.id as string, request.body);
  sendSuccess(response, { product });
};

export const publishProduct: RequestHandler = async (request, response) => {
  const product = await service.publishProduct(userId(response.locals), request.params.id as string);
  sendSuccess(response, { product });
};

export const archiveProduct: RequestHandler = async (request, response) => {
  const product = await service.archiveProduct(userId(response.locals), request.params.id as string);
  sendSuccess(response, { product });
};

export const createVariant: RequestHandler = async (request, response) => {
  const variant = await service.createVariant(userId(response.locals), request.params.productId as string, request.body);
  sendSuccess(response, { variant }, 201);
};

export const updateVariant: RequestHandler = async (request, response) => {
  const variant = await service.updateVariant(
    userId(response.locals),
    request.params.productId as string,
    request.params.variantId as string,
    request.body,
  );
  sendSuccess(response, { variant });
};

export const archiveVariant: RequestHandler = async (request, response) => {
  const variant = await service.archiveVariant(
    userId(response.locals),
    request.params.productId as string,
    request.params.variantId as string,
  );
  sendSuccess(response, { variant });
};

export const searchProducts: RequestHandler = async (request, response) => {
  const query = publicProductListSchema.parse(request.query);
  const result = await service.searchPublicProducts({
    page: query.page,
    limit: query.limit,
    sort: query.sort,
    ...(query.q ? { q: query.q } : {}),
    ...(query.category ? { category: query.category } : {}),
  });
  sendSuccess(response, { products: result.items }, 200, {
    page: query.page,
    limit: query.limit,
    total: result.total,
    totalPages: Math.ceil(result.total / query.limit),
  });
};

export const getPublicProduct: RequestHandler = async (request, response) => {
  const product = await service.getPublicProduct(request.params.storeSlug as string, request.params.productSlug as string);
  sendSuccess(response, { product });
};
