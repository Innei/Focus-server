/*
 * @Author: Innei
 * @Date: 2020-04-30 12:21:51
 * @LastEditTime: 2020-08-02 13:11:35
 * @LastEditors: Innei
 * @FilePath: /mx-server/src/shared/categories/categories.controller.ts
 * @Coding with Love
 */

/*
 * @Author: Innei
 * @Date: 2020-04-30 12:21:51
 * @LastEditTime: 2020-08-02 12:35:07
 * @LastEditors: Innei
 * @Description:
 * @FilePath: /mx-server/src/shared/categories/categories.controller.ts
 * @MIT
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger'
import { Types } from 'mongoose'
import { RolesGuard } from 'src/auth/roles.guard'
import { Master } from 'src/core/decorators/guest.decorator'
import { CannotFindException } from 'src/core/exceptions/cant-find.exception'
import { IdDto } from 'src/shared/base/dto/id.dto'
import { CategoriesService } from 'src/shared/categories/categories.service'
import {
  CategoryDto,
  MultiCategoriesQueryDto,
  MultiQueryTagAndCategoryDto,
  SlugOrIdDto,
} from 'src/shared/categories/dto/category.dto'
import { CategoryType } from '../../../libs/db/src/models/category.model'
import { PostsService } from '../posts/posts.service'

@Controller('categories')
@ApiTags('Category Routes')
@UseGuards(RolesGuard)
export class CategoriesController {
  constructor(
    private readonly service: CategoriesService,
    private readonly postService: PostsService,
  ) {}

  @Get()
  async getCategories(@Query() query: MultiCategoriesQueryDto) {
    const { ids, joint } = query // categories is category's mongo id
    if (ids) {
      // const categoryDocs = await this.categoryService.find({
      //   $and: [categories.map((id) => ({ _id: id }))],
      // })
      return joint
        ? await Promise.all(
            ids.map(async (id) => {
              return await this.postService.find(
                { categoryId: id },
                {
                  select: 'title slug _id categoryId created modified',
                  sort: { created: -1 },
                },
              )
            }),
          )
        : await Promise.all(
            ids.map(async (id) => {
              const posts = await this.postService.find(
                { categoryId: id },
                {
                  select: 'title slug _id created modified',
                  sort: { created: -1 },
                },
              )
              const category = await this.service.findById(id).lean()

              return {
                category: { ...category, children: posts },
              }
            }),
          )
    }
    return await this.service.find({})
  }

  @Get(':query')
  @ApiQuery({
    description: '混合查询 分类 和 标签云',
    name: 'tag',
    type: 'string',
    required: false,
  })
  async getCategoryById(
    @Param() { query }: SlugOrIdDto,
    @Query() { tag }: MultiQueryTagAndCategoryDto,
    @Master() isMaster: boolean,
  ) {
    if (tag === true) {
      return await this.service.findArticleWithTag(query)
    }

    if (!query) {
      throw new BadRequestException()
    }

    const isId = Types.ObjectId.isValid(query)
    const res = isId
      ? await this.service.findById(query).sort({ created: -1 }).lean()
      : await this.service.findOne({ slug: query }).sort({ created: -1 }).lean()

    if (!res) {
      throw new CannotFindException()
    }
    // FIXME category count if empty will be [] not null
    // the expect is [] or null
    const children =
      (await this.service.findCategoryPost(res._id, isMaster)) || []
    return { data: { ...res, children } }
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @ApiSecurity('bearer')
  async createCategory(@Body() body: CategoryDto) {
    const { name, slug } = body
    return this.service.createNew({ name, slug: slug ?? name })
  }

  @Put(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiSecurity('bearer')
  async modifyCategory(@Param() params: IdDto, @Body() body: CategoryDto) {
    const { type, slug, name } = body
    const { id } = params
    const res = await this.service.updateByIdAsync(id, {
      slug,
      type,
      name,
    })
    return res
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiSecurity('bearer')
  async deleteCategory(@Param() params: IdDto) {
    const { id } = params
    const category = await this.service.findById(id)
    if (!category) {
      throw new CannotFindException()
    }
    const postsInCategory = await this.service.findPostsInCategory(category._id)
    if (postsInCategory.length > 0) {
      throw new UnprocessableEntityException('该分类中有其他文章, 无法被删除')
    }
    const res = await this.service.deleteOne({
      _id: category._id,
    })
    if ((await this.service.countDocument({})) === 0) {
      await this.service.createDefaultCategory()
    }
    return res
  }
}
