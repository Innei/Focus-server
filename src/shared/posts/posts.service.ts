import Category from '@libs/db/models/category.model'
import Comment from '@libs/db/models/comment.model'
import Post from '@libs/db/models/post.model'
import { Injectable } from '@nestjs/common'
import { DocumentType, ReturnModelType } from '@typegoose/typegoose'
import { InjectModel } from 'nestjs-typegoose'
import { BaseService } from 'src/shared/base/base.service'
import { CannotFindException } from 'src/core/exceptions/cant-find.exception'

@Injectable()
export class PostsService extends BaseService<Post> {
  constructor(
    @InjectModel(Post) private readonly postModel: ReturnModelType<typeof Post>,
    @InjectModel(Category)
    private readonly categoryModel: ReturnModelType<typeof Category>,
    @InjectModel(Comment)
    private readonly commentModel: ReturnModelType<typeof Comment>,
  ) {
    super(postModel)
  }

  async getCategoryBySlug(slug: string): Promise<DocumentType<Category>> {
    return this.categoryModel.findOne({ slug })
  }

  async findPostById(id: string) {
    const doc = await super.findById(id).populate('category')
    if (!doc) {
      throw new CannotFindException()
    }
    return doc
  }

  async findCategoryById(id: string) {
    return this.categoryModel.findById(id)
  }

  async deletePost(id: string) {
    const r = await this.postModel.deleteOne({ _id: id })
    await this.commentModel.deleteMany({
      pid: id,
    })
    return r
  }
}
